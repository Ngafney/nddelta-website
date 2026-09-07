import { prepareBanditCode, runManyCode } from "./shared/banditCode.js";
const SEED="delta-week1-v2", N=10000;
const AM=`const argmax=(f)=>state.machines.reduce((b,m)=>f(m)>f(b)?m:b).index;`;
const POST=`const pm=(m)=>m.mean*m.plays/(m.plays+1); const sd=(m)=>lib.sqrt(100/(m.plays+1));`;
const S={
 "k=1.4":`${AM}${POST} return argmax(m=>pm(m)+1.4*sd(m));`,
 "k=1.5":`${AM}${POST} return argmax(m=>pm(m)+1.5*sd(m));`,
 "k=1.6":`${AM}${POST} return argmax(m=>pm(m)+1.6*sd(m));`,
 "k=1.7":`${AM}${POST} return argmax(m=>pm(m)+1.7*sd(m));`,
 "k=1.8":`${AM}${POST} return argmax(m=>pm(m)+1.8*sd(m));`,
 "raw mean + 1.6 sd (no shrink)":`${AM} const sd=(m)=>lib.sqrt(100/(m.plays+1)); return argmax(m=>m.mean+1.6*sd(m));`,
};
const rows=[];
for(const[n,b]of Object.entries(S)){const p=prepareBanditCode(b);if(!p.ok){console.log("ERR",n,p.error);continue;}rows.push([n,runManyCode(p.run,SEED,N).oraclePct]);}
rows.sort((a,b)=>b[1]-a[1]);
for(const[n,pct]of rows)console.log(pct.toFixed(2).padStart(6)+'%   '+n);
