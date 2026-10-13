/* Minimal markdown renderer for Claude replies and repo docs (no dependencies). */
window.MD = (() => {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

  function inline(src) {
    return String(src).split(/(`[^`]+`)/g).map((part) => {
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${esc(part.slice(1, -1))}</code>`;
      }
      let t = esc(part);
      t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<span class="md-img">[$1]</span>');
      t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => `<a data-href="${href}">${label}</a>`);
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[^\w*])\*([^*\n]+?)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
      t = t.replace(/(^|[^\w])_([^_\n]+?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
      t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      return t;
    }).join('');
  }

  const isItem = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, '  ').length;

  function list(lines, i) {
    const base = indentOf(lines[i]);
    const ordered = /^\s*\d+[.)]/.test(lines[i]);
    const items = [];
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) {
        if (i + 1 < lines.length && isItem(lines[i + 1]) && indentOf(lines[i + 1]) >= base) { i++; continue; }
        break;
      }
      const ind = indentOf(l);
      const m = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
      if (m && ind === base) { items.push({ text: m[2], sub: [] }); i++; continue; }
      if (ind > base && items.length) { items[items.length - 1].sub.push(l); i++; continue; }
      if (!m && items.length && ind >= base && !/^\s*(#|```|\|)/.test(l)) {
        items[items.length - 1].text += ' ' + l.trim(); i++; continue;
      }
      break;
    }
    const tag = ordered ? 'ol' : 'ul';
    const html = items.map((it) => {
      let text = it.text;
      let cls = '';
      const cb = text.match(/^\[( |x|X)\]\s+(.*)$/);
      if (cb) { cls = cb[1] === ' ' ? ' class="task"' : ' class="task done"'; text = cb[2]; }
      const sub = it.sub.length ? render(it.sub.map((s) => s.slice(Math.min(indentOf(s), base + 2))).join('\n')) : '';
      return `<li${cls}>${inline(text)}${sub}</li>`;
    }).join('');
    return [`<${tag}>${html}</${tag}>`, i];
  }

  function render(src) {
    const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m = line.match(/^\s*```\s*([\w+-]*)/);
      if (m) {
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(`<pre class="code" data-lang="${esc(m[1] || 'text')}"><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      if (/^<!--.*-->\s*$/.test(line.trim())) { i++; continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue;
      }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const row = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const head = row(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(row(lines[i])); i++; }
        out.push('<div class="tbl"><table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') +
          '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>');
        continue;
      }
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
        continue;
      }
      if (isItem(line)) { const [html, next] = list(lines, i); out.push(html); i = next; continue; }
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^\s*(```|#{1,4}\s|>)/.test(lines[i]) && !isItem(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('');
  }

  return { render, inline, esc };
})();
