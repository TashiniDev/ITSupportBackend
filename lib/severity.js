// Severity normalization and formatting helpers

function normalizeSeverityInput(v) {
    if (!v && v !== 0) return 'LOW';
    try {
        const s = String(v).trim();
        if (!s) return 'LOW';
        const up = s.toUpperCase();
        if (['LOW','MEDIUM','HIGH','CRITICAL'].includes(up)) return up;
        const map = {
            'L': 'LOW',
            'M': 'MEDIUM',
            'H': 'HIGH',
            'C': 'CRITICAL'
        };
        const first = up.charAt(0);
        return map[first] || 'LOW';
    } catch (e) {
        return 'LOW';
    }
}

function formatSeverityForFrontend(dbVal) {
    if (!dbVal && dbVal !== 0) return 'Low';
    const s = String(dbVal).trim().toUpperCase();
    if (s === 'LOW') return 'Low';
    if (s === 'MEDIUM') return 'Medium';
    if (s === 'HIGH') return 'High';
    if (s === 'CRITICAL') return 'Critical';
    return 'Low';
}

module.exports = {
    normalizeSeverityInput,
    formatSeverityForFrontend
};
