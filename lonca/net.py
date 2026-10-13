"""Which addresses the hub listens on and hands out in invites, and the QR codes for them.

A hub is reachable on this computer always, over Tailscale when it is up (encrypted, works from
anywhere, the default way in), on the local network only when asked (--lan: plain HTTP, tokens readable
by anyone on that network), and at a public URL when the host puts one in front of it (--url).
"""
from __future__ import annotations

import ipaddress
import shutil
import socket
import subprocess

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
TAILNET = ipaddress.ip_network("100.64.0.0/10")


def qr_svg(text: str) -> str | None:
    """The link as an SVG data URI (segno, in requirements.txt); None without segno, the link still works."""
    try:
        import segno
    except ImportError:
        return None
    return segno.make(text, error="m").svg_data_uri(scale=5, border=2, dark="#000000", light="#ffffff")


def tailscale_ip() -> str | None:
    exe = shutil.which("tailscale")
    for candidate in ([exe] if exe else []) + [r"C:\Program Files\Tailscale\tailscale.exe",
                                                 "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]:
        try:
            r = subprocess.run([candidate, "ip", "-4"], capture_output=True, text=True, timeout=6, creationflags=NO_WINDOW)
        except (OSError, subprocess.TimeoutExpired):
            continue
        ip = (r.stdout or "").strip().splitlines()[0] if r.returncode == 0 and (r.stdout or "").strip() else ""
        try:
            if ip and ipaddress.ip_address(ip) in TAILNET:
                return ip
        except ValueError:
            pass
    return None


def lan_ip() -> str | None:
    """The address this machine uses towards the local network (no packet is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    return ip if addr.is_private and not addr.is_loopback and addr not in TAILNET else None


def plan(port: int, lan: bool = False, url: str | None = None) -> tuple[list[str], list[dict]]:
    """(addresses to listen on, links to hand out with the best one first)."""
    hosts, links = ["127.0.0.1"], []
    if url:
        links.append({"label": "URL", "url": url.rstrip("/")})
    ts = tailscale_ip()
    if ts:
        hosts.append(ts)
        links.append({"label": "Tailscale", "url": f"http://{ts}:{port}"})
    if lan:
        local = lan_ip()
        hosts = ["0.0.0.0"]
        if local:
            links.append({"label": "LAN", "url": f"http://{local}:{port}"})
    links.append({"label": "localhost", "url": f"http://127.0.0.1:{port}", "local": True})
    return hosts, links
