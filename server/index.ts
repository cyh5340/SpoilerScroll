import { createServer } from 'node:http';
import { initAnalytics, shutdownAnalytics } from './analytics/keewano.js';
import { createRuntime } from './runtime.js';
import { createApplication } from './application.js';

const port=Number(process.env.PORT||8787);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
await initAnalytics();
const runtime=await createRuntime();
const server=createServer(createApplication(runtime));
server.listen(port,'127.0.0.1',()=>{
  console.log(`SpoilerScroll backend: http://127.0.0.1:${port}`);
  console.log(`Extension ID: ${runtime.extensionId}`);
  console.log(`Detector: ${runtime.status().detector}. ${runtime.status().history}.`);
  console.log('Open the extension popup, accept public-preview processing, and click Allow Reddit and connect.');
});
let stopping=false;
async function stop() {
  if(stopping)return;stopping=true;
  const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeIdleConnections();await closed;
  await runtime.close();await shutdownAnalytics();
}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
