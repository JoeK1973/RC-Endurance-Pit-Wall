"use client";
import {useEffect,useRef,useState} from "react";
import {createClient,hasSupabase} from "@/lib/supabase/client";

type Driver={id:string;name:string};
type Session={id:string;session_code:string};
type Race={id:string;duration_seconds:number;status:"idle"|"running"|"paused"|"finished";started_at:string|null;paused_at:string|null;accumulated_pause_seconds:number;current_driver_id:string|null;current_stint_started_at:string|null};
const fmt=(n:number)=>{n=Math.max(0,Math.floor(n));const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`};
const seconds=(iso:string|null)=>iso?Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000)):0;

export default function Home(){
 const [session,setSession]=useState<Session|null>(null),[race,setRace]=useState<Race|null>(null),[drivers,setDrivers]=useState<Driver[]>([]),[queue,setQueue]=useState<string[]>([]);
 const [joinCode,setJoinCode]=useState(""),[newDriver,setNewDriver]=useState(""),[now,setNow]=useState(Date.now()),[dark,setDark]=useState(false),[loading,setLoading]=useState(false),[message,setMessage]=useState("");
 const supabase=useRef<any>(null);
 useEffect(()=>{if(hasSupabase())supabase.current=createClient()},[]);
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[]);
 useEffect(()=>{document.documentElement.dataset.theme=dark?"dark":"light"},[dark]);

 const loadSession=async(code:string)=>{
  const db=supabase.current;if(!db)return setMessage("Add your Supabase environment variables first.");
  setLoading(true);setMessage("");
  const normalized=code.trim().toUpperCase();
  const {data:s,error}=await db.from("race_sessions").select("*").eq("session_code",normalized).single();
  if(error||!s){setLoading(false);return setMessage("Session not found. Check the share code.")}
  const {data:r}=await db.from("races").select("*").eq("session_id",s.id).single();
  const {data:d}=await db.from("drivers").select("*").eq("session_id",s.id).order("created_at");
  const {data:q}=await db.from("driver_queue").select("driver_id,position").eq("session_id",s.id).order("position");
  setSession(s);setRace(r);setDrivers(d??[]);setQueue((q??[]).map((x:any)=>x.driver_id));setLoading(false);
  history.replaceState(null,"",`/?session=${s.session_code}`);
 };
 useEffect(()=>{const p=new URLSearchParams(location.search).get("session");if(p&&supabase.current)loadSession(p)},[]);
 useEffect(()=>{if(!session||!supabase.current)return;const db=supabase.current;const channel=db.channel(`race-${session.id}`).on("postgres_changes",{event:"*",schema:"public",table:"races",filter:`session_id=eq.${session.id}`},()=>loadSession(session.session_code)).on("postgres_changes",{event:"*",schema:"public",table:"drivers",filter:`session_id=eq.${session.id}`},()=>loadSession(session.session_code)).on("postgres_changes",{event:"*",schema:"public",table:"driver_queue",filter:`session_id=eq.${session.id}`},()=>loadSession(session.session_code)).subscribe();return()=>{db.removeChannel(channel)}},[session?.id]);

 const create=async()=>{
  const db=supabase.current;if(!db)return setMessage("Add your Supabase environment variables first.");
  setLoading(true);setMessage("");
  const {data,error}=await db.rpc("create_race_session");
  if(error){setLoading(false);return setMessage(error.message)}
  await loadSession(data.session_code);
 };
 const addDriver=async()=>{
  if(!session||!newDriver.trim())return;const {data,error}=await supabase.current.from("drivers").insert({session_id:session.id,name:newDriver.trim()}).select().single();if(!error&&data){setNewDriver("");if(!race?.current_driver_id)await supabase.current.from("races").update({current_driver_id:data.id,current_stint_started_at:new Date().toISOString()}).eq("id",race.id)}
 };
 const editDriver=async(d:Driver)=>{const n=prompt("Driver name",d.name);if(n?.trim())await supabase.current.from("drivers").update({name:n.trim()}).eq("id",d.id)};
 const addQueue=async(id:string)=>{if(!session)return;await supabase.current.from("driver_queue").insert({session_id:session.id,driver_id:id,position:queue.length+1})};
 const removeQueue=async(id:string)=>{if(!session)return;await supabase.current.from("driver_queue").delete().eq("session_id",session.id).eq("driver_id",id)};
 const updateRace=async(p:any)=>race&&await supabase.current.from("races").update(p).eq("id",race.id);
 const start=async()=>{if(!race)return;const n=new Date().toISOString();if(race.status==="idle")await updateRace({status:"running",started_at:n,current_stint_started_at:race.current_stint_started_at??n});else if(race.status==="paused"){const paused=Math.floor((Date.now()-new Date(race.paused_at!).getTime())/1000);await updateRace({status:"running",paused_at:null,accumulated_pause_seconds:race.accumulated_pause_seconds+paused})}};
 const pause=()=>race?.status==="running"&&updateRace({status:"paused",paused_at:new Date().toISOString()});
 const reset=async()=>{if(race&&confirm("Reset this race?"))await updateRace({status:"idle",started_at:null,paused_at:null,accumulated_pause_seconds:0,current_stint_started_at:null})};
 const swap=async(type:"battery_swap"|"driver_swap"|"full_swap")=>{
  if(!session||!race)return;const next=queue[0]??null, nowIso=new Date().toISOString();
  let incoming=race.current_driver_id;
  if(type!=="battery_swap"&&next){incoming=next;await supabase.current.from("driver_queue").delete().eq("session_id",session.id).eq("driver_id",next);if(race.current_driver_id)await supabase.current.from("driver_queue").upsert({session_id:session.id,driver_id:race.current_driver_id,position:queue.length});}
  await supabase.current.from("race_events").insert({session_id:session.id,event_type:type,outgoing_driver_id:race.current_driver_id,incoming_driver_id:incoming});
  await updateRace({current_driver_id:incoming,current_stint_started_at:nowIso});
 };
 const elapsed=race?.started_at?(race.status==="idle"?0:Math.max(0,Math.floor((now-new Date(race.started_at).getTime())/1000)-race.accumulated_pause_seconds-(race.status==="paused"&&race.paused_at?Math.floor((now-new Date(race.paused_at).getTime())/1000):0))):0;
 const stint=race?.current_stint_started_at?seconds(race.current_stint_started_at):0;
 const current=drivers.find(d=>d.id===race?.current_driver_id);
 const share=async()=>{if(session){await navigator.clipboard?.writeText(session.session_code);setMessage("Session code copied.")}};
 if(!session)return <main><header><div><h1>RC ENDURANCE</h1><p>Create or join a live race session.</p></div><button className="icon" onClick={()=>setDark(!dark)}>{dark?"☀":"◐"}</button></header><section className="welcome"><h2>CREATE OR JOIN</h2><button className="primary big" disabled={loading} onClick={create}>{loading?"CREATING...":"+ CREATE NEW SESSION"}</button><div className="join"><input value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="ENTER SESSION CODE"/><button disabled={loading} onClick={()=>loadSession(joinCode)}>JOIN SESSION</button></div>{message&&<p className="message">{message}</p>}<p className="muted">Supabase: {hasSupabase()?"connected":"not configured"}</p></section></main>;
 return <main><header><div><h1>RC ENDURANCE</h1><p>Session <b>{session.session_code}</b> <button onClick={share}>COPY CODE</button> <button onClick={()=>{setSession(null);setRace(null);history.replaceState(null,"","/")}}>LEAVE</button></p></div><button className="icon" onClick={()=>setDark(!dark)}>{dark?"☀":"◐"}</button></header>
 <section className="hero"><div><span>RACE ELAPSED</span><strong>{fmt(elapsed)}</strong></div><div><span>TIME REMAINING</span><strong>{fmt((race?.duration_seconds??0)-elapsed)}</strong></div><div className="controls"><button className="primary" onClick={start}>{race?.status==="running"?"RUNNING":race?.status==="paused"?"RESUME":"START"}</button><button onClick={pause}>PAUSE</button><button className="danger" onClick={reset}>RESET</button></div></section>
 <section className="grid"><article className="card current"><span>CURRENT DRIVER</span><h2>{current?.name??"Add a driver"}</h2><b>STINT {fmt(stint)}</b><div className="swap"><button onClick={()=>swap("battery_swap")}>🔋 BATTERY SWAP</button><button onClick={()=>swap("driver_swap")} disabled={!queue.length}>👤 DRIVER SWAP</button><button className="full" onClick={()=>swap("full_swap")} disabled={!queue.length}>🔋 + 👤 FULL CHANGE</button></div></article>
 <article className="card"><span>DRIVER QUEUE</span><ol>{queue.map((id,i)=><li key={id}><b>{i+1}</b>{drivers.find(d=>d.id===id)?.name}<button onClick={()=>removeQueue(id)}>×</button></li>)}</ol><div className="add">{drivers.filter(d=>d.id!==race?.current_driver_id&&!queue.includes(d.id)).map(d=><button key={d.id} onClick={()=>addQueue(d.id)}>+ {d.name}</button>)}</div></article>
 <article className="card"><div className="titleRow"><span>DRIVERS</span></div><div className="addDriver"><input value={newDriver} onChange={e=>setNewDriver(e.target.value)} placeholder="Driver name"/><button onClick={addDriver}>ADD</button></div>{drivers.map(d=><div className="driver" key={d.id}><button className={current?.id===d.id?"selected":""} onClick={()=>updateRace({current_driver_id:d.id,current_stint_started_at:new Date().toISOString()})}>{d.name}</button><button onClick={()=>editDriver(d)}>✎</button></div>)}</article>
 <article className="card history"><span>SESSION STATUS</span><p>Live Supabase synchronisation is active. Open this session using <b>{session.session_code}</b> on another device.</p>{message&&<p className="message">{message}</p>}</article></section></main>
}