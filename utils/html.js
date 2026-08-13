function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function nl2br(escapedStr) {
    return escapedStr.replace(/\n/g, '<br>');
}

// Escapes raw text then converts newlines to <br> — safe to render with <%- %>.
function safeMultiline(str) {
    return nl2br(escapeHtml(str || ''));
}

module.exports = { escapeHtml, nl2br, safeMultiline };
