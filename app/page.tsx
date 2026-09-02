"use client";
import {useEffect,useMemo,useState} from "react";

type Driver={id:string,name:string};
const uid=()=>crypto.randomUUID();
const fmt=(n:number)=>{n=Math.max(0,Math.floor(n));const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`};

export default function Home(){
 const [duration,setDuration]=useState(4*3600),[target,setTarget]=useState(24*60);
 const [drivers,setDrivers]=useState<Driver[]>([{id:"1",name:"Joseph"},{id:"2",name:"Driver 2"},{id:"3",name:"Driver 3"}]);
 const [queue,setQueue]=useState(["2","3"]),[current,setCurrent]=useState("1");
 const [status,setStatus]=useState<"idle"|"running"|"paused">("idle");
 const [elapsed,setElapsed]=useState(0),[stint,setStint]=useState(0),[events,setEvents]=useState<string[]>([]);
 const [dark,setDark]=useState(false);
 useEffect(()=>{if(status!=="running")return;const t=setInterval(()=>{setElapsed(x=>x+1);setStint(x=>x+1)},1000);return()=>clearInterval(t)},[status]);
 useEffect(() => {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}, [dark]);
 const name=(id:string)=>drivers.find(d=>d.id===id)?.name??"No driver";
 const event=(text:string)=>setEvents(e=>[`${fmt(elapsed)} — ${text}`,...e].slice(0,30));
 const driverSwap=()=>{const next=queue[0];if(!next)return alert("Add a driver to the queue first.");event(`Driver change: ${name(current)} → ${name(next)}`);setCurrent(next);setQueue(q=>[...q.slice(1),current]);setStint(0)};
 const batterySwap=()=>{event(`Battery swap — ${name(current)} continues`);setStint(0)};
 const fullSwap=()=>{const next=queue[0];if(!next)return alert("Add a driver to the queue first.");event(`Battery + driver change: ${name(current)} → ${name(next)}`);setCurrent(next);setQueue(q=>[...q.slice(1),current]);setStint(0)};
 const reset=()=>{if(confirm("Reset the race?")){setStatus("idle");setElapsed(0);setStint(0);setEvents([])}};
 const addDriver=()=>{const n=prompt("Driver name");if(n?.trim())setDrivers(d=>[...d,{id:uid(),name:n.trim()}])};
 const currentDriver=drivers.find(d=>d.id===current);
 return <main>
  <header><div><h1>RC ENDURANCE</h1><p>Race control dashboard</p></div><button className="icon" onClick={()=>setDark(!dark)} aria-label="Toggle theme">{dark?"☀":"◐"}</button></header>
  <section className="hero">
   <div><span>RACE ELAPSED</span><strong>{fmt(elapsed)}</strong></div><div><span>TIME REMAINING</span><strong>{fmt(duration-elapsed)}</strong></div>
   <div className="controls"><button className="primary" onClick={()=>{if(status==="idle")event("Race started");if(status==="paused")event("Race resumed");setStatus("running")}}>{status==="running"?"RUNNING":status==="paused"?"RESUME":"START"}</button><button onClick={()=>{if(status==="running"){setStatus("paused");event("Race paused")}}}>PAUSE</button><button className="danger" onClick={reset}>RESET</button></div>
  </section>
  <section className="grid">
   <article className="card current"><span>CURRENT DRIVER</span><h2>{currentDriver?.name??"Select driver"}</h2><div className="stint"><div className="labels"><b>STINT {fmt(stint)}</b><b>{fmt(Math.max(0,target-stint))} LEFT</b></div><div className="bar"><i style={{width:`${Math.min(100,stint/target*100)}%`}}/></div><small>Target: <input type="number" value={Math.round(target/60)} onChange={e=>setTarget(Number(e.target.value)*60)}/> minutes</small></div>
   <div className="swap"><button onClick={batterySwap}>🔋 BATTERY SWAP</button><button onClick={driverSwap}>👤 DRIVER SWAP</button><button className="full" onClick={fullSwap}>🔋 + 👤 FULL CHANGE</button></div></article>
   <article className="card"><div className="titleRow"><span>DRIVER QUEUE</span><button onClick={addDriver}>+ DRIVER</button></div><ol>{queue.map((id,i)=><li key={id}><b>{i+1}</b>{name(id)}<button onClick={()=>setQueue(q=>q.filter(x=>x!==id))}>×</button></li>)}</ol>
   <div className="add">{drivers.filter(d=>d.id!==current&&!queue.includes(d.id)).map(d=><button key={d.id} onClick={()=>setQueue(q=>[...q,d.id])}>+ {d.name}</button>)}</div></article>
   <article className="card"><div className="titleRow"><span>DRIVERS</span><small>Tap name to edit</small></div>{drivers.map(d=><div className="driver" key={d.id}><button className={d.id===current?"selected":""} onClick={()=>setCurrent(d.id)}>{d.name}</button><button onClick={()=>{const n=prompt("Driver name",d.name);if(n?.trim())setDrivers(x=>x.map(v=>v.id===d.id?{...v,name:n.trim()}:v))}}>✎</button></div>)}</article>
   <article className="card history"><span>RACE EVENTS</span>{events.length?events.map((e,i)=><p key={i}>{e}</p>):<p className="muted">No events yet.</p>}</article>
  </section>
  <section className="settings"><label>Race duration <input type="number" value={duration/3600} min="0.1" step="0.5" onChange={e=>setDuration(Number(e.target.value)*3600)}/> hours</label></section>
 </main>
}
