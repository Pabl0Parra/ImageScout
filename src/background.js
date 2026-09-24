export function removeImageBackground(bytes,onProgress){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./background.worker.js',import.meta.url),{type:'module'});
  const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Background removal timed out. Check your connection, then try again. The first use downloads a model.'));},180000);
  worker.onmessage=({data})=>{if(data.progress)onProgress(data.progress);else {clearTimeout(timeout);worker.terminate();data.error?reject(new Error(data.error)):resolve(new Blob([data.bytes],{type:'image/png'}));}};
  worker.onerror=()=>{clearTimeout(timeout);worker.terminate();reject(new Error('Background removal could not start. Please check your connection and try again.'));};
  worker.postMessage(bytes);
 });
}
