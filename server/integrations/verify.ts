/** Opt-in live verification. Never prints credentials, raw rows, prompts or search tokens. */
import { DarwinSearch } from './darwin.js';
import { KeewanoHistoryReader, keewanoSqlConfig, type SqlClient } from './keewano.js';

if (process.argv.includes('--darwin')) {
  try {
    const capabilities = await new DarwinSearch().search('Extract main article text and evidence quotes from a public URL without cookies');
    console.log(JSON.stringify({verification:'live-discovery-only',capabilities:capabilities.map(c=>({agentId:c.agentId,capabilityId:c.capabilityId,revision:c.revision,readiness:c.readiness,canStartThread:c.canStartThread}))},null,2));
  } catch { console.error('Live Darwin discovery failed; no execution attempted'); process.exitCode=1; }
} else if (process.argv.includes('--keewano')) {
  const config = keewanoSqlConfig();
  const installId = process.env.SPOILERSCROLL_VERIFY_INSTALL_ID;
  const contentId = process.env.SPOILERSCROLL_VERIFY_CONTENT_ID;
  if (!config || !installId || !contentId) {
    console.error('Missing read credentials or expected smoke install/content IDs; read access unverified'); process.exitCode=1;
  } else {
    let pool: (SqlClient & {end():Promise<void>}) | undefined;
    try {
      const packageName='pg'; // Optional server dependency, installed by the wiring session.
      const pg = await import(packageName);
      pool = new pg.Pool(config);
      const reader=new KeewanoHistoryReader(pool);
      const result=await reader.recentViewed(installId,new Date(Date.now()-7*86400000),200);
      const attributed=result.status==='available' && result.data.some(row=>row.installId===installId && row.contentId===contentId);
      console.log(JSON.stringify({verification:'live-keewano-read',status:result.status,expectedSmokeAttribution:attributed}));
      if (!attributed) process.exitCode=1;
    } catch { console.error('Live Keewano read failed; check server credentials, pg dependency and project schema'); process.exitCode=1; }
    finally { await pool?.end(); }
  }
} else {
  console.error('Choose --darwin or --keewano; no live calls made'); process.exitCode=1;
}
