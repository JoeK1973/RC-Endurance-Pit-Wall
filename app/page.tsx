"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, hasSupabase } from "@/lib/supabase/client";

type Driver = {
  id: string;
  name: string;
};

type QueueItem = {
  id: string;
  driver_id: string;
  position: number;
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
  activity_rotation: number;
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

type Activity = {
  name: string;
  icon: string;
  className: string;
};

/*
 * Activity order around the team.

 * Relative to the current driver:
 *
 * Current driver = DRIVE
 * Next driver    = REST
 * Next driver    = PIT
 * Next driver    = MARSHAL
 *
 * This produces:
 *
 * Driver 1 driving:
 * D1 Drive
 * D2 Rest
 * D3 Pit
 * D4 Marshal
 *
 * Driver 2 driving:
 * D1 Marshal
 * D2 Drive
 * D3 Rest
 * D4 Pit
 */
const ACTIVITIES: Activity[] = [
  {
    name: "Drive",
    icon: "🚗",
    className: "drive",
  },
  {
    name: "Rest",
    icon: "🛌",
    className: "rest",
  },
  {
    name: "Pit",
    icon: "🔧",
    className: "pit",
  },
  {
    name: "Marshal",
    icon: "🚩",
    className: "marshal",
  },
];

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [race, setRace] = useState<Race | null>(null);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);

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
   * Update timers
   */
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  /*
   * Light / dark mode
   */
  useEffect(() => {
    document.documentElement.dataset.theme = dark
      ? "dark"
      : "light";
  }, [dark]);

  /*
   * Load a race session
   */
  const loadSession = async (code: string) => {
    const db = supabase.current;

    if (!db) {
      setMessage(
        "Add your Supabase environment variables first."
      );
      return;
    }

    setLoading(true);
    setMessage("");

    const normalized = code.trim().toUpperCase();

    const {
      data: sessionData,
      error: sessionError,
    } = await db
      .from("race_sessions")
      .select("*")
      .eq("session_code", normalized)
      .single();

    if (sessionError || !sessionData) {
      setLoading(false);

      setMessage(
        "Session not found. Check the share code."
      );

      return;
    }

    const {
      data: raceData,
      error: raceError,
    } = await db
      .from("races")
      .select("*")
      .eq("session_id", sessionData.id)
      .single();

    if (raceError || !raceData) {
      setLoading(false);

      setMessage(
        "Race data could not be loaded."
      );

      return;
    }

    const { data: driverData } = await db
      .from("drivers")
      .select("*")
      .eq("session_id", sessionData.id)
      .order("created_at");

    const { data: queueData } = await db
      .from("driver_queue")
      .select("id, driver_id, position")
      .eq("session_id", sessionData.id)
      .order("position");

    setSession(sessionData);

    setRace({
      ...raceData,
      activity_rotation:
        raceData.activity_rotation ?? 0,
    });

    setDrivers(driverData ?? []);

    setQueue(queueData ?? []);

    setLoading(false);

    window.history.replaceState(
      null,
      "",
      `/?session=${sessionData.session_code}`
    );
  };

  /*
   * Load session from URL
   */
  useEffect(() => {
    const sessionCode =
      new URLSearchParams(
        window.location.search
      ).get("session");

    if (
      sessionCode &&
      supabase.current
    ) {
      loadSession(sessionCode);
    }
  }, []);

  /*
   * Realtime updates
   */
  useEffect(() => {
    if (!session || !supabase.current) {
      return;
    }

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
   * Create a new session
   */
  const createSession = async () => {
    const db = supabase.current;

    if (!db) {
      setMessage(
        "Add your Supabase environment variables first."
      );
      return;
    }

    setLoading(true);
    setMessage("");

    const { data, error } =
      await db.rpc("create_race_session");

    if (error || !data) {
      setLoading(false);

      setMessage(
        error?.message ??
          "Could not create session."
      );

      return;
    }

    await loadSession(data.session_code);
  };

  /*
   * Add driver
   */
  const addDriver = async () => {
    if (
      !session ||
      !race ||
      !newDriver.trim()
    ) {
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
     * First driver becomes
     * the current driver.
     */
    if (!race.current_driver_id) {
      await db
        .from("races")
        .update({
          current_driver_id: data.id,
          current_stint_started_at:
            new Date().toISOString(),
        })
        .eq("id", race.id);
    }
  };

  /*
   * Edit driver
   */
  const editDriver = async (
    driver: Driver
  ) => {
    const newName = prompt(
      "Driver name",
      driver.name
    );

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
   * Add a driver to the queue.

   * Duplicates are intentionally allowed.
   */
  const addQueue = async (
    driverId: string
  ) => {
    if (!session) {
      return;
    }

    const db = supabase.current;

    if (!db) {
      return;
    }

    const nextPosition =
      queue.length > 0
        ? Math.max(
            ...queue.map(
              (item) => item.position
            )
          ) + 1
        : 1;

    const { error } = await db
      .from("driver_queue")
      .insert({
        session_id: session.id,
        driver_id: driverId,
        position: nextPosition,
      });

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Remove one specific queue entry.
   *
   * This works correctly even when the
   * same driver appears multiple times.
   */
  const removeQueue = async (
    queueItemId: string
  ) => {
    const db = supabase.current;

    if (!db) {
      return;
    }

    const { error } = await db
      .from("driver_queue")
      .delete()
      .eq("id", queueItemId);

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Update race
   */
  const updateRace = async (
    updates: Partial<Race>
  ) => {
    if (!race) {
      return;
    }

    const db = supabase.current;

    if (!db) {
      return;
    }

    const { error } = await db
      .from("races")
      .update(updates)
      .eq("id", race.id);

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Start / resume race
   */
  const startRace = async () => {
    if (!race) {
      return;
    }

    const nowIso =
      new Date().toISOString();

    if (race.status === "idle") {
      await updateRace({
        status: "running",
        started_at: nowIso,
        current_stint_started_at:
          race.current_stint_started_at ??
          nowIso,
      });

      return;
    }

    if (
      race.status === "paused" &&
      race.paused_at
    ) {
      const pausedSeconds =
        Math.floor(
          (Date.now() -
            new Date(
              race.paused_at
            ).getTime()) /
            1000
        );

      await updateRace({
        status: "running",
        paused_at: null,
        accumulated_pause_seconds:
          race.accumulated_pause_seconds +
          pausedSeconds,
      });
    }
  };

  /*
   * Pause race
   */
  const pauseRace = async () => {
    if (
      !race ||
      race.status !== "running"
    ) {
      return;
    }

    await updateRace({
      status: "paused",
      paused_at:
        new Date().toISOString(),
    });
  };

  /*
   * Reset race
   */
  const resetRace = async () => {
    if (!race) {
      return;
    }

    const confirmed =
      window.confirm(
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
      activity_rotation: 0,
    });
  };

  /*
   * Complete a battery and/or driver swap.
   */
  const swap = async (
    type:
      | "battery_swap"
      | "driver_swap"
      | "full_swap"
  ) => {
    if (!session || !race) {
      return;
    }

    const db = supabase.current;

    if (!db) {
      return;
    }

    const firstQueueItem =
      queue[0] ?? null;

    const nowIso =
      new Date().toISOString();

    let incomingDriverId =
      race.current_driver_id;

    /*
     * Driver change
     */
    if (type !== "battery_swap") {
      if (!firstQueueItem) {
        setMessage(
          "There is no driver in the queue."
        );

        return;
      }

      incomingDriverId =
        firstQueueItem.driver_id;

      /*
       * Remove ONLY the first queue entry.
       *
       * Important for duplicate drivers.
       */
      const { error: removeError } =
        await db
          .from("driver_queue")
          .delete()
          .eq(
            "id",
            firstQueueItem.id
          );

      if (removeError) {
        setMessage(
          removeError.message
        );

        return;
      }

      /*
       * Add outgoing driver to the
       * back of the queue.
       */
      if (race.current_driver_id) {
        const nextPosition =
          queue.length > 0
            ? Math.max(
                ...queue.map(
                  (item) =>
                    item.position
                )
              ) + 1
            : 1;

        await db
          .from("driver_queue")
          .insert({
            session_id:
              session.id,

            driver_id:
              race.current_driver_id,

            position:
              nextPosition,
          });
      }
    }

    /*
     * Record event
     */
    await db
      .from("race_events")
      .insert({
        session_id: session.id,

        event_type: type,

        outgoing_driver_id:
          race.current_driver_id,

        incoming_driver_id:
          incomingDriverId,
      });

    /*
     * Start new stint.

     * Battery-only changes reset the stint
     * but do not change activities.
     */
    const updates: Partial<Race> = {
      current_driver_id:
        incomingDriverId,

      current_stint_started_at:
        nowIso,
    };

    /*
     * Advance the activity rotation
     * only when the driver changes.
     */
    if (type !== "battery_swap") {
      updates.activity_rotation =
        (race.activity_rotation + 1) %
        Math.max(drivers.length, 1);
    }

    await updateRace(updates);
  };

  /*
   * Calculate elapsed race time
   */
  const elapsed = race?.started_at
    ? Math.max(
        0,
        Math.floor(
          (now -
            new Date(
              race.started_at
            ).getTime()) /
            1000
        ) -
          race.accumulated_pause_seconds -
          (race.status === "paused" &&
          race.paused_at
            ? Math.floor(
                (now -
                  new Date(
                    race.paused_at
                  ).getTime()) /
                  1000
              )
            : 0)
      )
    : 0;

  /*
   * Current stint
   */
  const stint =
    race?.current_stint_started_at
      ? secondsSince(
          race.current_stint_started_at
        )
      : 0;

  const currentDriver =
    drivers.find(
      (driver) =>
        driver.id ===
        race?.current_driver_id
    );

  /*
   * Activity calculation
   *
   * The current driver is always
   * at position 0 = DRIVE.
   *
   * The other drivers rotate around them:
   *
   * 0 Drive
   * 1 Rest
   * 2 Pit
   * 3 Marshal
   */
  const getActivityForDriver = (
    driverId: string
  ): Activity => {
    if (
      !race?.current_driver_id ||
      drivers.length === 0
    ) {
      return ACTIVITIES[1];
    }

    const currentIndex =
      drivers.findIndex(
        (driver) =>
          driver.id ===
          race.current_driver_id
      );

    const driverIndex =
      drivers.findIndex(
        (driver) =>
          driver.id === driverId
      );

    if (
      currentIndex === -1 ||
      driverIndex === -1
    ) {
      return ACTIVITIES[1];
    }

    /*
     * Work out the driver's position
     * relative to the current driver.
     */
    const relativePosition =
      (driverIndex -
        currentIndex +
        drivers.length) %
      drivers.length;

    /*
     * Activities repeat if more than
     * four drivers are present.
     */
    return ACTIVITIES[
      relativePosition %
        ACTIVITIES.length
    ];
  };

  /*
   * Copy session code
   */
  const copyShareCode = async () => {
    if (!session) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        session.session_code
      );

      setMessage(
        "Session code copied."
      );
    } catch {
      setMessage(
        `Session code: ${session.session_code}`
      );
    }
  };

  /*
   * JOIN SCREEN
   */
  if (!session) {
    return (
      <main>
        <header>
          <div>
            <h1>RC ENDURANCE</h1>

            <p>
              Create or join a live race
              session.
            </p>
          </div>

          <button
            className="icon"
            onClick={() =>
              setDark(!dark)
            }
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
                setJoinCode(
                  event.target.value
                )
              }
              placeholder="ENTER SESSION CODE"
            />

            <button
              disabled={loading}
              onClick={() =>
                loadSession(joinCode)
              }
            >
              JOIN SESSION
            </button>
          </div>

          {message && (
            <p className="message">
              {message}
            </p>
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
   * MAIN DASHBOARD
   */
  return (
    <main>
      <header>
        <div>
          <h1>RC ENDURANCE</h1>

          <p>
            Session{" "}
            <b>
              {session.session_code}
            </b>{" "}

            <button
              onClick={copyShareCode}
            >
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
          onClick={() =>
            setDark(!dark)
          }
        >
          {dark ? "☀" : "◐"}
        </button>
      </header>

      {/* RACE TIMER */}

      <section className="hero">
        <div>
          <span>
            RACE ELAPSED
          </span>

          <strong>
            {fmt(elapsed)}
          </strong>
        </div>

        <div>
          <span>
            TIME REMAINING
          </span>

          <strong>
            {fmt(
              race.duration_seconds -
                elapsed
            )}
          </strong>
        </div>

        <div className="controls">
          <button
            className="primary"
            onClick={startRace}
          >
            {race.status ===
            "running"
              ? "RUNNING"
              : race.status ===
                "paused"
              ? "RESUME"
              : "START"}
          </button>

          <button
            onClick={pauseRace}
          >
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

        {/* CURRENT DRIVER */}

        <article className="card current">
          <span>
            CURRENT DRIVER
          </span>

          <h2>
            {currentDriver?.name ??
              "Add a driver"}
          </h2>

          <b>
            STINT {fmt(stint)}
          </b>

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

        {/* ACTIVITY TRACKER */}

        <article className="card activity">
          <div className="titleRow">
            <span>
              ACTIVITY TRACKER
            </span>

            <small>
              DRIVE → MARSHAL → PIT → REST
            </small>
          </div>

          <div className="activityList">
            {drivers.map(
              (driver) => {
                const activity =
                  getActivityForDriver(
                    driver.id
                  );

                const isDriving =
                  driver.id ===
                  race.current_driver_id;

                return (
                  <div
                    className={`activityRow ${activity.className} ${
                      isDriving
                        ? "activeDriver"
                        : ""
                    }`}
                    key={driver.id}
                  >
                    <div>
                      <strong>
                        {driver.name}
                      </strong>

                      {isDriving && (
                        <small>
                          CURRENT DRIVER
                        </small>
                      )}
                    </div>

                    <div className="activityStatus">
                      <span>
                        {activity.icon}
                      </span>

                      <b>
                        {activity.name}
                      </b>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </article>

        {/* DRIVER QUEUE */}

        <article className="card">
          <div className="titleRow">
            <span>
              DRIVER QUEUE
            </span>

            <small>
              Unlimited queue
            </small>
          </div>

          <ol>
            {queue.map(
              (queueItem, index) => {
                const driver =
                  drivers.find(
                    (item) =>
                      item.id ===
                      queueItem.driver_id
                  );

                return (
                  <li
                    key={queueItem.id}
                  >
                    <b>
                      {index + 1}
                    </b>

                    {driver?.name ??
                      "Unknown driver"}

                    <button
                      onClick={() =>
                        removeQueue(
                          queueItem.id
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                );
              }
            )}
          </ol>

          <div className="add">
            {drivers.map(
              (driver) => (
                <button
                  key={driver.id}
                  onClick={() =>
                    addQueue(driver.id)
                  }
                >
                  + {driver.name}
                </button>
              )
            )}
          </div>
        </article>

        {/* DRIVERS */}

        <article className="card">
          <div className="titleRow">
            <span>
              DRIVERS
            </span>
          </div>

          <div className="addDriver">
            <input
              value={newDriver}
              onChange={(event) =>
                setNewDriver(
                  event.target.value
                )
              }
              placeholder="Driver name"
            />

            <button
              onClick={addDriver}
            >
              ADD
            </button>
          </div>

          {drivers.map(
            (driver) => (
              <div
                className="driver"
                key={driver.id}
              >
                <button
                  className={
                    currentDriver?.id ===
                    driver.id
                      ? "selected"
                      : ""
                  }
                  onClick={() =>
                    updateRace({
                      current_driver_id:
                        driver.id,

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
            )
          )}
        </article>

        {/* SESSION STATUS */}

        <article className="card history">
          <span>
            SESSION STATUS
          </span>

          <p>
            Live Supabase
            synchronisation is active.
          </p>

          <p>
            Share code:{" "}
            <b>
              {session.session_code}
            </b>
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
