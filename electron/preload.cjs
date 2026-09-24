const { contextBridge, ipcRenderer } = require('electron');
const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
const legacyRecord = (record) => ({ ...record,
  query: record.sources?.find(source => source.query)?.query || record.title, path: true });
async function importDropped(files) {
  if (!Array.isArray(files)) throw new Error('Import files must be a list.');
  const prepared = files.map(file => ({ name: String(file?.name || 'Image'), bytes: file?.bytes }));
  if (!prepared.length) return { records: [], errors: [] };
  const session = await ipcRenderer.invoke('vault:drop-begin', prepared.map(file => ({
    name: file.name, size: file.bytes instanceof Uint8Array ? file.bytes.byteLength : -1
  })));
  const records = [], errors = [...session.errors];
  for (let index = 0; index < session.accepted.length; index += 1) {
    const accepted = session.accepted[index];
    const file = prepared[accepted.sourceIndex];
    const result = await ipcRenderer.invoke('vault:drop-file', session.token, index, accepted.name, file.bytes);
    if (result.record) records.push(result.record); else if (result.error) errors.push(result.error);
  }
  return { records, errors };
}
contextBridge.exposeInMainWorld('scout', {
  settings: call('settings:get'), configure: call('settings:set'), search: call('images:search'),
  save: call('images:save'), imageBytes: call('images:bytes'),
  library: () => ipcRenderer.invoke('vault:list').then(records => records.map(legacyRecord)),
  reveal: call('vault:reveal'), hide: call('window:hide'),
  vault: {
    info: call('vault:info'), import: call('vault:import'), importDropped,
    list: call('vault:list'), copy: call('vault:copy'), export: call('vault:export'),
    reveal: call('vault:reveal'), delete: call('vault:delete'), bytes: call('vault:bytes')
  },
  onFocus: (callback) => { const listener = () => callback(); ipcRenderer.on('window:focus-search', listener); return () => ipcRenderer.removeListener('window:focus-search', listener); }
});
