"""End to end on one machine: a hub, two members, a node with a `command` agent. Localhost only, no Claude.

    python -m unittest discover -s tests
"""
import json
import socket
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lonca.hub import Hub, HubError  # noqa: E402
from lonca.node import Node, Refused, call  # noqa: E402
from lonca.store import write_json  # noqa: E402

ECHO = [sys.executable, "-c", "import sys; t = sys.stdin.read(); print('step one'); print('ANSWER:' + t.rsplit(']', 1)[-1].strip())"]
SLOW = [sys.executable, "-c", "import time; print('started', flush=True); time.sleep(60)"]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def until(check, seconds=15.0):
    end = time.time() + seconds
    while time.time() < end:
        value = check()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("timed out waiting")


class Flow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.dir = Path(self.tmp.name)
        self.hub = Hub(self.dir / "hub")
        self.owner = self.hub.setup("Workshop", "Kaan")
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.hub.addresses = [{"label": "localhost", "url": self.base, "local": True}]
        self.assertEqual(self.hub.listen(["127.0.0.1"], self.port), [])
        self.owner_token = self.hub.new_device(self.owner["id"], "browser", "test")
        self.nodes = []

    def tearDown(self):
        for node in self.nodes:
            node.stop()
        self.hub.close()
        time.sleep(0.2)
        self.tmp.cleanup()

    def node(self, member_id, name, agents):
        profile = self.dir / "servers" / f"{member_id}.json"
        write_json(profile, {"server": self.hub.public_server(), "hub": self.base, "member": {"id": member_id, "name": name},
                             "token": self.hub.new_device(member_id, "node", "pc"), "agents": agents})
        node = Node(profile, log=lambda text: None)
        node.start()
        self.nodes.append(node)
        until(lambda: node.connected)
        return node

    def agent(self, handle, command=ECHO, **extra):
        return dict({"handle": handle, "kind": "command", "dir": str(self.dir), "command": command, "access": "owner"}, **extra)

    def job_of(self, handle):
        return next((j for j in self.hub.jobs.values() if j["agent"] == handle), None)

    def done(self, handle):
        def check():
            job = self.job_of(handle)
            return job if job and job["status"] == "done" else None
        return until(check)

    def test_auth(self):
        with self.assertRaises(Refused) as ctx:
            call(self.base, "/api/state")
        self.assertEqual(ctx.exception.status, 401)
        with self.assertRaises(Refused):
            call(self.base, "/api/state", token="nope.nope")
        self.assertEqual(call(self.base, "/api/state", token=self.owner_token)["me"]["id"], self.owner["id"])
        # a post without the custom header is refused even with a valid token (cross-site guard)
        req = urllib.request.Request(self.base + "/api/send", data=json.dumps({"ch": "general", "text": "x"}).encode(),
                                     headers={"Authorization": f"Bearer {self.owner_token}"}, method="POST")
        with self.assertRaises(urllib.error.HTTPError) as http:
            urllib.request.urlopen(req)
        self.assertEqual(http.exception.code, 400)
        self.assertEqual(self.hub.messages("general")["messages"], [])
        # tokens are stored hashed
        self.assertNotIn(self.owner_token.split(".")[1], (self.dir / "hub" / "devices.json").read_text())

    def test_invite_join_once(self):
        code = call(self.base, "/api/invite", {}, self.owner_token)["code"]
        info = call(self.base, f"/api/info?code={code}")
        self.assertTrue(info["invite"])
        self.assertEqual(info["by"], "Kaan")
        with self.assertRaises(Refused) as ctx:  # the owner's name is taken, and the invite survives the failed try
            call(self.base, "/api/join", {"code": code, "name": "kaan", "kind": "node"})
        self.assertEqual(ctx.exception.code, "name_taken")
        joined = call(self.base, "/api/join", {"code": code, "name": "Arda", "kind": "node"})
        self.assertEqual(joined["member"]["id"], "arda")
        self.assertEqual(call(self.base, "/api/state", token=joined["token"])["me"]["name"], "Arda")
        with self.assertRaises(Refused) as ctx:
            call(self.base, "/api/join", {"code": code, "name": "Third", "kind": "node"})
        self.assertEqual(ctx.exception.code, "invite_invalid")

    def test_pair_once_and_revoke(self):
        code = call(self.base, "/api/pair", {"kind": "node"}, self.owner_token)["code"]
        first = call(self.base, "/api/redeem", {"code": code, "device": "laptop"})
        self.assertEqual(first["member"]["id"], self.owner["id"])
        with self.assertRaises(Refused):
            call(self.base, "/api/redeem", {"code": code})
        devices = call(self.base, "/api/devices", token=self.owner_token)["devices"]
        laptop = next(d for d in devices if d["name"] == "laptop")
        call(self.base, "/api/revoke", {"id": laptop["id"]}, self.owner_token)
        with self.assertRaises(Refused):
            call(self.base, "/api/state", token=first["token"])
        # a browser pair code never hands its token to a script: it goes into an HttpOnly cookie
        code = call(self.base, "/api/pair", {"kind": "browser"}, self.owner_token)["code"]
        self.assertNotIn("token", call(self.base, "/api/redeem", {"code": code}))

    def test_mention_runs_the_agent(self):
        self.node(self.owner["id"], "Kaan", [self.agent("echo")])
        until(lambda: self.hub.agents.get("echo", {}).get("online"))
        call(self.base, "/api/send", {"ch": "general", "text": "earlier chatter"}, self.owner_token)
        call(self.base, "/api/send", {"ch": "general", "text": "@echo say hi"}, self.owner_token)
        job = self.done("echo")
        self.assertEqual(job["text"].splitlines()[-1], "ANSWER:@echo say hi")
        self.assertIn("step one", [s["text"] for s in job["steps"]])
        rows = call(self.base, "/api/messages?ch=general", token=self.owner_token)
        self.assertEqual(rows["messages"][-1]["job"], job["id"])
        self.assertEqual(rows["jobs"][job["id"]]["status"], "done")
        until(lambda: not self.hub.agents["echo"]["busy"])
        # the answer itself contains "@echo": an agent's output never starts a job
        self.assertEqual(len(self.hub.jobs), 1)

    def test_command_with_the_prompt_as_an_argument(self):
        inline = [sys.executable, "-c", "import sys; print('GOT:' + sys.argv[1][-6:])", "{prompt}"]
        self.node(self.owner["id"], "Kaan", [self.agent("inl", inline)])
        until(lambda: self.hub.agents.get("inl", {}).get("online"))
        call(self.base, "/api/send", {"ch": "general", "text": "@inl abcdef"}, self.owner_token)
        self.assertEqual(self.done("inl")["text"], "GOT:abcdef")

    def test_only_the_owner_calls_a_private_agent(self):
        arda = self.hub._new_member("Arda")
        arda_token = self.hub.new_device(arda["id"], "browser")
        self.node(self.owner["id"], "Kaan", [self.agent("mine"), self.agent("open", access="everyone")])
        until(lambda: self.hub.agents.get("open", {}).get("online"))
        call(self.base, "/api/send", {"ch": "general", "text": "@mine do it"}, arda_token)
        self.assertIsNone(self.job_of("mine"))
        self.assertEqual(self.hub.messages("general")["messages"][-1]["sys"]["code"], "agent_private")
        call(self.base, "/api/send", {"ch": "general", "text": "@open do it"}, arda_token)
        self.assertEqual(self.done("open")["by"]["id"], "arda")
        # another member's node cannot take over a handle that is in use
        other = self.node(arda["id"], "Arda", [self.agent("mine")])
        self.assertEqual(self.hub.agents["mine"]["owner"], self.owner["id"])
        self.assertEqual(other.offered, [])

    def test_stop_and_offline(self):
        node = self.node(self.owner["id"], "Kaan", [self.agent("slow", SLOW)])
        until(lambda: self.hub.agents.get("slow", {}).get("online"))
        call(self.base, "/api/send", {"ch": "general", "text": "@slow go"}, self.owner_token)

        def running():
            job = self.job_of("slow")
            return job if job and job["status"] == "running" and job["steps"] else None
        job = until(running)
        self.assertTrue(self.hub.agents["slow"]["busy"])
        call(self.base, "/api/stop", {"id": job["id"]}, self.owner_token)
        until(lambda: job["status"] == "stopped")
        node.stop()
        until(lambda: not self.hub.agents["slow"]["online"])
        call(self.base, "/api/send", {"ch": "general", "text": "@slow again"}, self.owner_token)
        self.assertEqual(self.hub.messages("general")["messages"][-1]["sys"]["code"], "agent_offline")

    def test_channels_and_limits(self):
        channel = call(self.base, "/api/channel", {"name": "Çizim Odası"}, self.owner_token)["channel"]
        self.assertEqual(channel["id"], "cizim-odasi")
        call(self.base, "/api/send", {"ch": "cizim-odasi", "text": "merhaba"}, self.owner_token)
        self.assertEqual(self.hub.messages("cizim-odasi")["messages"][0]["text"], "merhaba")
        with self.assertRaises(Refused) as ctx:
            call(self.base, "/api/send", {"ch": "nope", "text": "x"}, self.owner_token)
        self.assertEqual(ctx.exception.code, "no_channel")
        with self.assertRaises(HubError):
            self.hub.send(self.owner, "general", "x" * 20_001)
        # the state survives a restart of the hub
        again = Hub(self.dir / "hub")
        self.assertEqual(again.messages("cizim-odasi")["messages"][0]["text"], "merhaba")
        self.assertIsNotNone(again.auth(self.owner_token))

    def test_static_files_stay_inside_the_ui_folder(self):
        for path in ("/../hub.py", "/..%2Fhub.py", "/%2e%2e/hub.py", "/app.js/../../hub.py"):
            try:
                body = urllib.request.urlopen(self.base + path).read().decode()
            except urllib.error.HTTPError as exc:
                self.assertEqual(exc.code, 404, path)
                continue
            self.assertNotIn("class Hub", body, path)


if __name__ == "__main__":
    unittest.main()
