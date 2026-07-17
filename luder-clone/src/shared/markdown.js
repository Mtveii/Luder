// markdown.js — лёгкий рендер ответа ИИ в HTML, без внешних либ (4.3.8)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.renderMarkdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function renderInline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return out;
  }

  function renderMarkdown(text) {
    const lines = text.split('\n');
    const html = [];
    let listType = null;
    let inCodeBlock = false;
    let codeBuffer = [];

    function closeList() { if (listType) { html.push(`</${listType}>`); listType = null; } }

    for (const rawLine of lines) {
      if (rawLine.trim().startsWith('```')) {
        if (inCodeBlock) { html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`); codeBuffer = []; }
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) { codeBuffer.push(rawLine); continue; }

      const numbered = rawLine.match(/^\s*\d+\.\s+(.*)/);
      const bulleted = rawLine.match(/^\s*[-*]\s+(.*)/);

      if (numbered) {
        if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol'; }
        html.push(`<li>${renderInline(numbered[1])}</li>`);
      } else if (bulleted) {
        if (listType !== 'ul') { closeList(); html.push('<ul>'); listType = 'ul'; }
        html.push(`<li>${renderInline(bulleted[1])}</li>`);
      } else {
        closeList();
        html.push(rawLine.trim() === '' ? '<br/>' : `<p>${renderInline(rawLine)}</p>`);
      }
    }
    closeList();
    return html.join('\n');
  }

  return renderMarkdown;
});
