export const nowIso = () => new Date().toISOString();
export const addMinutes = (d, m) => new Date(new Date(d).getTime() + m * 60000);
export const addSeconds = (d, s) => new Date(new Date(d).getTime() + s * 1000);
