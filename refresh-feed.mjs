#!/usr/bin/env node
/**
 * refresh-feed.mjs — zero-dependency, CI-safe clean bounty feed generator.
 * Runs in GitHub Actions with GITHUB_TOKEN. Writes bounties.json.
 * Drops scam-ring / hardware-gated / points-only listings. Keeps crawl honest.
 */
import { writeFileSync, readFileSync } from 'node:fs';

const TOKEN = process.env.GITHUB_TOKEN || '';
const OUT = 'bounties.json';
const SCAM = ['bounty-plaza','bounty-bot','oss-verification-sandbox','agent-bounties','misakanet','sn-monetization-runtime','relayhop','frantic-board'];
const HW = ['wormhole','blackhole','tt-metal','tenstorrent','n150','p100a','cuda','npu'];
const PTS = ['reputation points','not money','hanzo rewards'];

const QUERIES = [
  'is:issue is:open label:bounty created:>2026-09-01',
  'is:issue is:open label:bounty USDC created:>2026-09-01',
  'is:issue is:open label:bounty in:title fix created:>2026-09-01',
  'is:issue is:open label:bounty in:title "$" created:>2026-09-01',
];

async function search(q){
  const url = 'https://api.github.com/search/issues?per_page=50&sort=created&order=desc&q='+encodeURIComponent(q);
  const r = await fetch(url, { headers: { Authorization:`Bearer ${TOKEN}`, Accept:'application/vnd.github+json', 'User-Agent':'glider-feed' } });
  if (!r.ok) { console.error('search fail', r.status); return []; }
  return (await r.json()).items || [];
}

function classify(it){
  const full = ((it.title||'')+' '+(it.repository_url||'')).toLowerCase();
  const f=[];
  if (SCAM.some(s=>full.includes(s))) f.push('scam-ring');
  if (HW.some(s=>full.includes(s))) f.push('hardware-gated');
  if (PTS.some(s=>full.includes(s))) f.push('points-not-money');
  if ((it.assignees||[]).length>0) f.push('assigned');
  return f;
}

async function main(){
  let prev=[];
  try { prev = JSON.parse(readFileSync(OUT,'utf8')).bounties||[]; } catch {}
  const seen=new Set(); const out=[];
  for (const q of QUERIES){
    for (const it of await search(q)){
      if (seen.has(it.html_url)) continue; seen.add(it.html_url);
      const repo = it.repository_url.replace('https://api.github.com/repos/','');
      const m = (it.title+' '+(it.body||'')).match(/\$\s?([0-9][0-9,]{1,6})|([0-9][0-9,]{1,6})\s?(usdc|usdt|dai)/i);
      const b = { id:'gh:'+it.id, source:'github', repo, number:it.number, title:it.title,
        url:it.html_url, reward_amount: m?Number((m[1]||m[2]).replace(/,/g,'')):null,
        reward_currency: m?'USD/USDC':null, assigned:(it.assignees||[]).length>0,
        posted_at:it.created_at, status:'open' };
      b.flags = classify(b);
      if (b.flags.length) continue;
      out.push(b);
    }
  }
  if (!out.length){
    console.error(`no clean results; keeping ${prev.length} previous`);
    if (prev.length) return;   // do not overwrite good data with empty
  }
  out.sort((a,b)=>(b.reward_amount||0)-(a.reward_amount||0));
  writeFileSync(OUT, JSON.stringify({ generated:new Date().toISOString(), count:out.length, bounties:out }, null, 2));
  console.log('wrote', out.length, 'clean bounties');
}
main().catch(e=>{ console.error(e); process.exit(1); });
