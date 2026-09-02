"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, hasSupabase } from "@/lib/supabase/client";

type Driver = {
  id: string;
  name: string;
};

type Session = {
  id: string;
  session_code: string;
};

type Race = {
  id: string;
  duration_seconds: number;
  status: "idle" | "running" | "paused" | "finished";
  started_at: string | null;
  paused_at: string | null;
  accumulated_pause_seconds: number;
  current_driver_id: string | null;
  current_stint_started_at: string | null;
};

const fmt = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(
      minutes
    ).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(
    secs
  ).padStart(2, "0")}`;
};

const secondsSince = (iso: string | null) => {
  if (!iso) return 0;

  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  );
};

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [race, setRace] = useState<Race | null>(null);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [queue, setQueue] = useState<string[]>([]);

  const [joinCode, setJoinCode] = useState("");
  const [newDriver, setNewDriver] = useState("");

  const [now, setNow] = useState(Date.now());
  const [dark, setDark] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const supabase = useRef<any>(null);

  /*
   * Initialise Supabase
   */
  useEffect(() => {
    if (hasSupabase()) {
      supabase.current = createClient();
    }
  }, []);

  /*
   * Update timers every second
   */
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  /*
   * Theme
   */
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  /*
   * Load a session from Supabase
   */
  const loadSession = async (code: string) => {
    const db = supabase.current;

    if (!db) {
      setMessage("Add your Supabase environment variables first.");
      return;
    }

    setLoading(true);
    setMessage("");

    const normalized = code.trim().toUpperCase();

    const { data: sessionData, error: sessionError } = await db
      .from("race_sessions")
      .select("*")
      .eq("session_code", normalized)
      .single();

    if (sessionError || !sessionData) {
      setLoading(false);
      setMessage("Session not found. Check the share code.");
      return;
    }

    const { data: raceData, error: raceError } = await db
      .from("races")
      .select("*")
      .eq("session_id", sessionData.id)
      .single();

    if (raceError || !raceData) {
      setLoading(false);
      setMessage("Race data could not be loaded.");
      return;
    }

    const { data: driverData } = await db
      .from("drivers")
      .select("*")
      .eq("session_id", sessionData.id)
      .order("created_at");

    const { data: queueData } = await db
      .from("driver_queue")
      .select("driver_id, position")
      .eq("session_id", sessionData.id)
      .order("position");

    setSession(sessionData);
    setRace(raceData);
    setDrivers(driverData ?? []);
    setQueue((queueData ?? []).map((item: { driver_id: string }) => item.driver_id));

    setLoading(false);

    window.history.replaceState(
      null,
      "",
      `/?session=${sessionData.session_code}`
    );
  };

  /*
   * Automatically load session from URL
   */
  useEffect(() => {
    const sessionCode = new URLSearchParams(
      window.location.search
    ).get("session");

    if (sessionCode && supabase.current) {
      loadSession(sessionCode);
    }
  }, []);

  /*
   * Realtime synchronisation
   */
  useEffect(() => {
    if (!session || !supabase.current) return;

    const db = supabase.current;

    const refreshSession = () => {
      loadSession(session.session_code);
    };

    const channel = db
      .channel(`race-${session.id}`)

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "races",
          filter: `session_id=eq.${session.id}`,
        },
        refreshSession
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "drivers",
          filter: `session_id=eq.${session.id}`,
        },
        refreshSession
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_queue",
          filter: `session_id=eq.${session.id}`,
        },
        refreshSession
      )

      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [session?.id]);

  /*
   * Create a new race session
   */
  const createSession = async () => {
    const db = supabase.current;

    if (!db) {
      setMessage("Add your Supabase environment variables first.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { data, error } = await db.rpc("create_race_session");

    if (error || !data) {
      setLoading(false);
      setMessage(error?.message ?? "Could not create session.");
      return;
    }

    await loadSession(data.session_code);
  };

  /*
   * Add driver
   */
  const addDriver = async () => {
    if (!session || !race || !newDriver.trim()) {
      return;
    }

    const db = supabase.current;

    if (!db) {
      return;
    }

    const { data, error } = await db
      .from("drivers")
      .insert({
        session_id: session.id,
        name: newDriver.trim(),
      })
      .select()
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    if (!data) {
      return;
    }

    setNewDriver("");

    /*
     * Automatically make the first driver
     * the current driver.
     */
    if (!race.current_driver_id) {
      await db
        .from("races")
        .update({
          current_driver_id: data.id,
          current_stint_started_at: new Date().toISOString(),
        })
        .eq("id", race.id);
    }
  };

  /*
   * Edit driver name
   */
  const editDriver = async (driver: Driver) => {
    const newName = prompt("Driver name", driver.name);

    if (!newName?.trim()) {
      return;
    }

    const db = supabase.current;

    if (!db) {
      return;
    }

    await db
      .from("drivers")
      .update({
        name: newName.trim(),
      })
      .eq("id", driver.id);
  };

  /*
   * Add driver to queue
   */
  const addQueue = async (driverId: string) => {
    if (!session) {
      return;
    }

    const db = supabase.current;

    if (!db) {
      return;
    }

    await db.from("driver_queue").insert({
      session_id: session.id,
      driver_id: driverId,
      position: queue.length + 1,
    });
  };

  /*
   * Remove driver from queue
   */
  const removeQueue = async (driverId: string) => {
    if (!session) {
      return;
    }

    const db = supabase.current;

    if (!db) {
      return;
    }

    await db
      .from("driver_queue")
      .delete()
      .eq("session_id", session.id)
      .eq("driver_id", driverId);
  };

  /*
   * Update race
   */
  const updateRace = async (updates: Partial<Race>) => {
    if (!race) {
      return;
    }

    const db = supabase.current;

    if (!db) {
      return;
    }

    await db
      .from("races")
      .update(updates)
      .eq("id", race.id);
  };

  /*
   * Start or resume race
   */
  const startRace = async () => {
    if (!race) {
      return;
    }

    const nowIso = new Date().toISOString();

    if (race.status === "idle") {
      await updateRace({
        status: "running",
        started_at: nowIso,
        current_stint_started_at:
          race.current_stint_started_at ?? nowIso,
      });

      return;
    }

    if (race.status === "paused") {
      if (!race.paused_at) {
        return;
      }

      const pausedSeconds = Math.floor(
        (Date.now() - new Date(race.paused_at).getTime()) / 1000
      );

      await updateRace({
        status: "running",
        paused_at: null,
        accumulated_pause_seconds:
          race.accumulated_pause_seconds + pausedSeconds,
      });
    }
  };

  /*
   * Pause race
   */
  const pauseRace = async () => {
    if (!race || race.status !== "running") {
      return;
    }

    await updateRace({
      status: "paused",
      paused_at: new Date().toISOString(),
    });
  };

  /*
   * Reset race
   */
  const resetRace = async () => {
    if (!race) {
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to reset this race?"
    );

    if (!confirmed) {
      return;
    }

    await updateRace({
      status: "idle",
      started_at: null,
      paused_at: null,
      accumulated_pause_seconds: 0,
      current_stint_started_at: null,
    });
  };

  /*
   * Swap handling
   */
  const swap = async (
    type: "battery_swap" | "driver_swap" | "full_swap"
  ) => {
    if (!session || !race) {
      return;
    }

    const db = supabase.current;

    if (!db) {
      return;
    }

    const nextDriverId = queue[0] ?? null;
    const nowIso = new Date().toISOString();

    let incomingDriverId = race.current_driver_id;

    /*
     * Driver swap
     */
    if (type !== "battery_swap") {
      if (!nextDriverId) {
        setMessage("There is no driver in the queue.");
        return;
      }

      incomingDriverId = nextDriverId;

      /*
       * Remove next driver from front of queue
       */
      await db
        .from("driver_queue")
        .delete()
        .eq("session_id", session.id)
        .eq("driver_id", nextDriverId);

      /*
       * Put outgoing driver at back of queue
       */
      if (race.current_driver_id) {
        await db
          .from("driver_queue")
          .upsert(
            {
              session_id: session.id,
              driver_id: race.current_driver_id,
              position: queue.length,
            },
            {
              onConflict: "session_id,driver_id",
            }
          );
      }
    }

    /*
     * Record race event
     */
    await db.from("race_events").insert({
      session_id: session.id,
      event_type: type,
      outgoing_driver_id: race.current_driver_id,
      incoming_driver_id: incomingDriverId,
    });

    /*
     * Update current driver and stint
     */
    await updateRace({
      current_driver_id: incomingDriverId,
      current_stint_started_at: nowIso,
    });
  };

  /*
   * Calculate race elapsed time
   */
  const elapsed = race?.started_at
    ? race.status === "idle"
      ? 0
      : Math.max(
          0,
          Math.floor(
            (now - new Date(race.started_at).getTime()) / 1000
          ) -
            race.accumulated_pause_seconds -
            (race.status === "paused" && race.paused_at
              ? Math.floor(
                  (now - new Date(race.paused_at).getTime()) /
                    1000
                )
              : 0)
        )
    : 0;

  /*
   * Current stint time
   */
  const stint = race?.current_stint_started_at
    ? secondsSince(race.current_stint_started_at)
    : 0;

  const currentDriver = drivers.find(
    (driver) => driver.id === race?.current_driver_id
  );

  /*
   * Copy share code
   */
  const copyShareCode = async () => {
    if (!session) {
      return;
    }

    try {
      await navigator.clipboard.writeText(session.session_code);

      setMessage("Session code copied.");
    } catch {
      setMessage(`Session code: ${session.session_code}`);
    }
  };

  /*
   * SESSION JOIN SCREEN
   */
  if (!session) {
    return (
      <main>
        <header>
          <div>
            <h1>RC ENDURANCE</h1>
            <p>Create or join a live race session.</p>
          </div>

          <button
            className="icon"
            onClick={() => setDark(!dark)}
          >
            {dark ? "☀" : "◐"}
          </button>
        </header>

        <section className="welcome">
          <h2>CREATE OR JOIN</h2>

          <button
            className="primary big"
            disabled={loading}
            onClick={createSession}
          >
            {loading
              ? "CREATING..."
              : "+ CREATE NEW SESSION"}
          </button>

          <div className="join">
            <input
              value={joinCode}
              onChange={(event) =>
                setJoinCode(event.target.value)
              }
              placeholder="ENTER SESSION CODE"
            />

            <button
              disabled={loading}
              onClick={() => loadSession(joinCode)}
            >
              JOIN SESSION
            </button>
          </div>

          {message && (
            <p className="message">{message}</p>
          )}

          <p className="muted">
            Supabase:{" "}
            {hasSupabase()
              ? "configured"
              : "not configured"}
          </p>
        </section>
      </main>
    );
  }

  /*
   * RACE DASHBOARD
   */
  return (
    <main>
      <header>
        <div>
          <h1>RC ENDURANCE</h1>

          <p>
            Session <b>{session.session_code}</b>{" "}

            <button onClick={copyShareCode}>
              COPY CODE
            </button>{" "}

            <button
              onClick={() => {
                setSession(null);
                setRace(null);
                setDrivers([]);
                setQueue([]);

                window.history.replaceState(
                  null,
                  "",
                  "/"
                );
              }}
            >
              LEAVE
            </button>
          </p>
        </div>

        <button
          className="icon"
          onClick={() => setDark(!dark)}
        >
          {dark ? "☀" : "◐"}
        </button>
      </header>

      <section className="hero">
        <div>
          <span>RACE ELAPSED</span>

          <strong>{fmt(elapsed)}</strong>
        </div>

        <div>
          <span>TIME REMAINING</span>

          <strong>
            {fmt(
              (race?.duration_seconds ?? 0) -
                elapsed
            )}
          </strong>
        </div>

        <div className="controls">
          <button
            className="primary"
            onClick={startRace}
          >
            {race?.status === "running"
              ? "RUNNING"
              : race?.status === "paused"
              ? "RESUME"
              : "START"}
          </button>

          <button onClick={pauseRace}>
            PAUSE
          </button>

          <button
            className="danger"
            onClick={resetRace}
          >
            RESET
          </button>
        </div>
      </section>

      <section className="grid">
        <article className="card current">
          <span>CURRENT DRIVER</span>

          <h2>
            {currentDriver?.name ?? "Add a driver"}
          </h2>

          <b>STINT {fmt(stint)}</b>

          <div className="swap">
            <button
              onClick={() =>
                swap("battery_swap")
              }
            >
              🔋 BATTERY SWAP
            </button>

            <button
              onClick={() =>
                swap("driver_swap")
              }
              disabled={!queue.length}
            >
              👤 DRIVER SWAP
            </button>

            <button
              className="full"
              onClick={() =>
                swap("full_swap")
              }
              disabled={!queue.length}
            >
              🔋 + 👤 FULL CHANGE
            </button>
          </div>
        </article>

        <article className="card">
          <span>DRIVER QUEUE</span>

          <ol>
            {queue.map((driverId, index) => (
              <li key={driverId}>
                <b>{index + 1}</b>

                {
                  drivers.find(
                    (driver) =>
                      driver.id === driverId
                  )?.name
                }

                <button
                  onClick={() =>
                    removeQueue(driverId)
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ol>

          <div className="add">
            {drivers
              .filter(
                (driver) =>
                  driver.id !==
                    race?.current_driver_id &&
                  !queue.includes(driver.id)
              )
              .map((driver) => (
                <button
                  key={driver.id}
                  onClick={() =>
                    addQueue(driver.id)
                  }
                >
                  + {driver.name}
                </button>
              ))}
          </div>
        </article>

        <article className="card">
          <div className="titleRow">
            <span>DRIVERS</span>
          </div>

          <div className="addDriver">
            <input
              value={newDriver}
              onChange={(event) =>
                setNewDriver(event.target.value)
              }
              placeholder="Driver name"
            />

            <button onClick={addDriver}>
              ADD
            </button>
          </div>

          {drivers.map((driver) => (
            <div
              className="driver"
              key={driver.id}
            >
              <button
                className={
                  currentDriver?.id === driver.id
                    ? "selected"
                    : ""
                }
                onClick={() =>
                  updateRace({
                    current_driver_id: driver.id,
                    current_stint_started_at:
                      new Date().toISOString(),
                  })
                }
              >
                {driver.name}
              </button>

              <button
                onClick={() =>
                  editDriver(driver)
                }
              >
                ✎
              </button>
            </div>
          ))}
        </article>

        <article className="card history">
          <span>SESSION STATUS</span>

          <p>
            Live Supabase synchronisation is active.
            Open this session using{" "}
            <b>{session.session_code}</b> on
            another device.
          </p>

          {message && (
            <p className="message">
              {message}
            </p>
          )}
        </article>
      </section>
    </main>
  );
}
