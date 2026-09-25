import { removeBackground } from '@imgly/background-removal';
self.onmessage = async ({ data }) => {
  try {
    const blob = await removeBackground(
      new Blob([data], { type: 'image/png' }),
      {
        model: 'isnet_quint8',
        proxyToWorker: false,
        progress: (key, current, total) =>
          self.postMessage({
            progress: total
              ? `${key.startsWith('fetch') ? 'Downloading model' : 'Processing'} · ${Math.round((current / total) * 100)}%`
              : 'Removing background…',
          }),
      },
    );
    const bytes = await blob.arrayBuffer();
    self.postMessage({ bytes }, [bytes]);
  } catch (error) {
    self.postMessage({ error: error.message || 'Background removal failed.' });
  }
};
