"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createClient, hasSupabase } from "@/lib/supabase/client";

type Driver = {
  id: string;
  name: string;
  created_at?: string;
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

type RaceStatus = "idle" | "running" | "paused" | "finished";

type Race = {
  id: string;
  session_id: string;
  duration_seconds: number;
  status: RaceStatus;
  started_at: string | null;
  paused_at: string | null;
  accumulated_pause_seconds: number;
  current_driver_id: string | null;
  current_stint_started_at: string | null;
  activity_rotation: number;
};

type Activity = {
  name: string;
  icon: string;
  className: string;
};

/*
 * The activity display is arranged relative to the
 * current driver.
 *
 * Current driver:
 *   Drive
 *
 * Next driver in the driver list:
 *   Rest
 *
 * Next:
 *   Pit
 *
 * Next:
 *   Marshal
 *
 * Example:
 *
 * Driver 1 driving:
 * Driver 1 = Drive
 * Driver 2 = Rest
 * Driver 3 = Pit
 * Driver 4 = Marshal
 *
 * Driver 2 driving:
 * Driver 1 = Marshal
 * Driver 2 = Drive
 * Driver 3 = Rest
 * Driver 4 = Pit
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

const fmt = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));

  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  return `${String(hours).padStart(2, "0")}:${String(
    minutes
  ).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const secondsSince = (iso: string | null, now: number) => {
  if (!iso) return 0;

  const start = new Date(iso).getTime();

  if (Number.isNaN(start)) return 0;

  return Math.max(
    0,
    Math.floor((now - start) / 1000)
  );
};

export default function Home() {
  const supabase = useRef<any>(null);

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

  const [showShare, setShowShare] = useState(false);

  /*
   * Initialise Supabase.
   */
  useEffect(() => {
    if (hasSupabase()) {
      supabase.current = createClient();
    }
  }, []);

  /*
   * Update the visible timers every second.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  /*
   * Apply theme.
   */
  useEffect(() => {
    document.documentElement.dataset.theme = dark
      ? "dark"
      : "light";
  }, [dark]);

  /*
   * Load all data belonging to a session.
   */
  const loadSession = useCallback(async (code: string) => {
    const db = supabase.current;

    if (!db) {
      setMessage("Supabase is not configured.");
      return;
    }

    const normalizedCode = code.trim().toUpperCase();

    if (!normalizedCode) {
      return;
    }

    setLoading(true);
    setMessage("");

    const {
      data: sessionData,
      error: sessionError,
    } = await db
      .from("race_sessions")
      .select("*")
      .eq("session_code", normalizedCode)
      .single();

    if (sessionError || !sessionData) {
      setLoading(false);

      setMessage(
        sessionError?.message ??
          "Session not found."
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
        raceError?.message ??
          "Race data could not be loaded."
      );

      return;
    }

    const {
      data: driverData,
      error: driverError,
    } = await db
      .from("drivers")
      .select("*")
      .eq("session_id", sessionData.id)
      .order("created_at", {
        ascending: true,
      });

    if (driverError) {
      setMessage(driverError.message);
    }

    const {
      data: queueData,
      error: queueError,
    } = await db
      .from("driver_queue")
      .select("id, driver_id, position")
      .eq("session_id", sessionData.id)
      .order("position", {
        ascending: true,
      });

    if (queueError) {
      setMessage(queueError.message);
    }

    const loadedSession: Session = {
      id: sessionData.id,
      session_code: sessionData.session_code,
    };

    const loadedRace: Race = {
      id: raceData.id,
      session_id: raceData.session_id,
      duration_seconds: Number(
        raceData.duration_seconds ?? 0
      ),
      status: raceData.status as RaceStatus,
      started_at: raceData.started_at ?? null,
      paused_at: raceData.paused_at ?? null,
      accumulated_pause_seconds: Number(
        raceData.accumulated_pause_seconds ?? 0
      ),
      current_driver_id:
        raceData.current_driver_id ?? null,
      current_stint_started_at:
        raceData.current_stint_started_at ?? null,
      activity_rotation: Number(
        raceData.activity_rotation ?? 0
      ),
    };

    setSession(loadedSession);
    setRace(loadedRace);
    setDrivers(driverData ?? []);
    setQueue(queueData ?? []);

    setLoading(false);

    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        `/?session=${loadedSession.session_code}`
      );
    }
  }, []);

  /*
   * Load a session from a shared URL.
   */
  useEffect(() => {
    if (!supabase.current) return;

    const params = new URLSearchParams(
      window.location.search
    );

    const sessionCode = params.get("session");

    if (sessionCode) {
      void loadSession(sessionCode);
    }
  }, [loadSession]);

  /*
   * Realtime updates.
   *
   * Any device connected to this session should refresh
   * when drivers, queue or race state changes.
   */
  useEffect(() => {
    if (!session) return;

    const db = supabase.current;

    if (!db) return;

    const sessionId = session.id;
    const sessionCode = session.session_code;

    const refresh = () => {
      void loadSession(sessionCode);
    };

    const channel = db
      .channel(`race-session-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "races",
          filter: `session_id=eq.${sessionId}`,
        },
        refresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "drivers",
          filter: `session_id=eq.${sessionId}`,
        },
        refresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_queue",
          filter: `session_id=eq.${sessionId}`,
        },
        refresh
      )
      .subscribe();

    return () => {
      void db.removeChannel(channel);
    };
  }, [session, loadSession]);

  /*
   * Create a new race session.
   */
  const createSession = async () => {
    const db = supabase.current;

    if (!db) {
      setMessage("Supabase is not configured.");
      return;
    }

    setLoading(true);
    setMessage("");

    const {
      data,
      error,
    } = await db.rpc("create_race_session");

    if (error || !data) {
      setLoading(false);

      setMessage(
        error?.message ??
          "Could not create a session."
      );

      return;
    }

    await loadSession(data.session_code);
  };

  /*
   * Add a driver.
   */
  const addDriver = async () => {
    const currentSession = session;
    const currentRace = race;
    const name = newDriver.trim();

    if (
      !currentSession ||
      !currentRace ||
      !name
    ) {
      return;
    }

    const db = supabase.current;

    if (!db) return;

    setMessage("");

    const {
      data,
      error,
    } = await db
      .from("drivers")
      .insert({
        session_id: currentSession.id,
        name,
      })
      .select()
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    if (!data) return;

    setNewDriver("");

    /*
     * The first driver automatically becomes
     * the current driver.
     */
    if (!currentRace.current_driver_id) {
      const { error: updateError } = await db
        .from("races")
        .update({
          current_driver_id: data.id,
          current_stint_started_at:
            new Date().toISOString(),
        })
        .eq("id", currentRace.id);

      if (updateError) {
        setMessage(updateError.message);
      }
    }
  };

  /*
   * Edit a driver's name.
   */
  const editDriver = async (driver: Driver) => {
    const name = prompt(
      "Driver name",
      driver.name
    );

    if (!name?.trim()) return;

    const db = supabase.current;

    if (!db) return;

    const { error } = await db
      .from("drivers")
      .update({
        name: name.trim(),
      })
      .eq("id", driver.id);

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Add a driver to the queue.
   *
   * Duplicates are deliberately allowed.
   */
  const addQueue = async (driverId: string) => {
    const currentSession = session;

    if (!currentSession) return;

    const db = supabase.current;

    if (!db) return;

    const highestPosition = queue.reduce(
      (highest, item) =>
        Math.max(highest, item.position),
      0
    );

    const { error } = await db
      .from("driver_queue")
      .insert({
        session_id: currentSession.id,
        driver_id: driverId,
        position: highestPosition + 1,
      });

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Remove exactly one queue item.
   *
   * This means that if Driver A appears three times,
   * clicking remove on one entry only removes that entry.
   */
  const removeQueue = async (
    queueItemId: string
  ) => {
    const db = supabase.current;

    if (!db) return;

    const { error } = await db
      .from("driver_queue")
      .delete()
      .eq("id", queueItemId);

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Update the race safely.
   */
  const updateRace = async (
    updates: Partial<Race>
  ) => {
    const currentRace = race;

    if (!currentRace) return;

    const db = supabase.current;

    if (!db) return;

    const { error } = await db
      .from("races")
      .update(updates)
      .eq("id", currentRace.id);

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Start or resume race.
   */
  const startRace = async () => {
    const currentRace = race;

    if (!currentRace) return;

    const nowIso = new Date().toISOString();

    if (currentRace.status === "idle") {
      await updateRace({
        status: "running",
        started_at: nowIso,
        paused_at: null,
        accumulated_pause_seconds: 0,
        current_stint_started_at:
          currentRace.current_stint_started_at ??
          nowIso,
      });

      return;
    }

    if (
      currentRace.status === "paused" &&
      currentRace.paused_at
    ) {
      const pausedFor = Math.max(
        0,
        Math.floor(
          (Date.now() -
            new Date(
              currentRace.paused_at
            ).getTime()) /
            1000
        )
      );

      await updateRace({
        status: "running",
        paused_at: null,
        accumulated_pause_seconds:
          currentRace.accumulated_pause_seconds +
          pausedFor,
      });
    }
  };

  /*
   * Pause race.
   */
  const pauseRace = async () => {
    const currentRace = race;

    if (
      !currentRace ||
      currentRace.status !== "running"
    ) {
      return;
    }

    await updateRace({
      status: "paused",
      paused_at: new Date().toISOString(),
    });
  };

  /*
   * Reset race timer and current stint.
   */
  const resetRace = async () => {
    const currentRace = race;

    if (!currentRace) return;

    const confirmed = window.confirm(
      "Are you sure you want to reset the race?"
    );

    if (!confirmed) return;

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
   * Battery swap, driver swap or both.
   */
  const swap = async (
    type:
      | "battery_swap"
      | "driver_swap"
      | "full_swap"
  ) => {
    const currentSession = session;
    const currentRace = race;

    if (
      !currentSession ||
      !currentRace
    ) {
      return;
    }

    const db = supabase.current;

    if (!db) return;

    setMessage("");

    let incomingDriverId =
      currentRace.current_driver_id;

    const firstQueueItem =
      queue.length > 0
        ? queue[0]
        : null;

    /*
     * Driver changes use the first queue entry.
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
       * Remove only this specific queue entry.
       */
      const {
        error: deleteError,
      } = await db
        .from("driver_queue")
        .delete()
        .eq("id", firstQueueItem.id);

      if (deleteError) {
        setMessage(deleteError.message);
        return;
      }

      /*
       * Add the outgoing driver to the back
       * of the queue.
       */
      if (
        currentRace.current_driver_id
      ) {
        const highestPosition =
          queue.reduce(
            (highest, item) =>
              Math.max(
                highest,
                item.position
              ),
            0
          );

        const {
          error: insertError,
        } = await db
          .from("driver_queue")
          .insert({
            session_id:
              currentSession.id,
            driver_id:
              currentRace.current_driver_id,
            position:
              highestPosition + 1,
          });

        if (insertError) {
          setMessage(
            insertError.message
          );
          return;
        }
      }
    }

    /*
     * Save the event.
     */
    const { error: eventError } = await db
      .from("race_events")
      .insert({
        session_id: currentSession.id,
        event_type: type,
        outgoing_driver_id:
          currentRace.current_driver_id,
        incoming_driver_id:
          incomingDriverId,
      });

    if (eventError) {
      setMessage(eventError.message);
    }

    /*
     * Every swap starts a fresh stint.
     */
    await updateRace({
      current_driver_id:
        incomingDriverId,
      current_stint_started_at:
        new Date().toISOString(),
      activity_rotation:
        type !== "battery_swap"
          ? currentRace.activity_rotation + 1
          : currentRace.activity_rotation,
    });
  };

  /*
   * Set the current driver manually.
   *
   * Useful before the race starts or if you
   * need to correct the current driver.
   */
  const setCurrentDriver = async (
    driverId: string
  ) => {
    const currentRace = race;

    if (!currentRace) return;

    await updateRace({
      current_driver_id: driverId,
      current_stint_started_at:
        new Date().toISOString(),
    });
  };

  /*
   * Create the share URL.
   */
  const getShareLink = () => {
    if (!session) return "";

    if (typeof window === "undefined") {
      return "";
    }

    return `${window.location.origin}/?session=${encodeURIComponent(
      session.session_code
    )}`;
  };

  /*
   * Copy the complete URL.
   */
  const copyShareLink = async () => {
    const shareLink = getShareLink();

    if (!shareLink) return;

    try {
      await navigator.clipboard.writeText(
        shareLink
      );

      setMessage("Share link copied.");
    } catch {
      setMessage(
        "Could not copy the share link."
      );
    }
  };

  /*
   * Leave the current session.
   */
  const leaveSession = () => {
    setSession(null);
    setRace(null);
    setDrivers([]);
    setQueue([]);
    setMessage("");
    setShowShare(false);

    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        "/"
      );
    }
  };

  /*
   * Calculate elapsed race time.
   */
  const elapsed = (() => {
    if (!race?.started_at) {
      return 0;
    }

    const startedAt = new Date(
      race.started_at
    ).getTime();

    if (Number.isNaN(startedAt)) {
      return 0;
    }

    let total =
      Math.floor(
        (now - startedAt) / 1000
      ) -
      race.accumulated_pause_seconds;

    /*
     * If currently paused, don't count
     * time since the pause began.
     */
    if (
      race.status === "paused" &&
      race.paused_at
    ) {
      const pausedAt = new Date(
        race.paused_at
      ).getTime();

      if (!Number.isNaN(pausedAt)) {
        total -= Math.floor(
          (now - pausedAt) / 1000
        );
      }
    }

    return Math.max(0, total);
  })();

  /*
   * Calculate current stint.
   *
   * Stint time stops while the race is paused.
   */
  const stint = (() => {
    if (
      !race?.current_stint_started_at
    ) {
      return 0;
    }

    let total = secondsSince(
      race.current_stint_started_at,
      now
    );

    if (
      race.status === "paused" &&
      race.paused_at
    ) {
      total -= secondsSince(
        race.paused_at,
        now
      );
    }

    return Math.max(0, total);
  })();

  const currentDriver =
    drivers.find(
      (driver) =>
        driver.id ===
        race?.current_driver_id
    ) ?? null;

  /*
   * Calculate activity for a driver.
   */
  const getActivityForDriver = (
    driverId: string
  ): Activity => {
    const currentDriverId =
      race?.current_driver_id;

    if (
      !currentDriverId ||
      drivers.length === 0
    ) {
      return ACTIVITIES[1];
    }

    const currentIndex =
      drivers.findIndex(
        (driver) =>
          driver.id === currentDriverId
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

    const relativePosition =
      (driverIndex -
        currentIndex +
        drivers.length) %
      drivers.length;

    return ACTIVITIES[
      relativePosition %
        ACTIVITIES.length
    ];
  };

  /*
   * Join/create screen.
   *
   * This ensures race and session are both
   * guaranteed to exist below this point.
   */
  if (!session || !race) {
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
              setDark((value) => !value)
            }
            aria-label="Toggle theme"
          >
            {dark ? "☀" : "◐"}
          </button>
        </header>

        <section className="welcome">
          <h2>CREATE OR JOIN</h2>

          <button
            className="primary big"
            disabled={loading}
            onClick={() => {
              void createSession();
            }}
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
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !loading &&
                  joinCode.trim()
                ) {
                  void loadSession(joinCode);
                }
              }}
              placeholder="ENTER SESSION CODE"
            />

            <button
              disabled={
                loading ||
                !joinCode.trim()
              }
              onClick={() => {
                void loadSession(joinCode);
              }}
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
   * From here onwards TypeScript knows
   * both objects exist.
   */
  const activeRace = race;
  const activeSession = session;

  const timeRemaining = Math.max(
    0,
    activeRace.duration_seconds - elapsed
  );

  const shareLink = getShareLink();

  return (
    <main>
      <header>
        <div>
          <h1>RC ENDURANCE</h1>

          <p>
            Session{" "}
            <b>
              {activeSession.session_code}
            </b>{" "}

            <button
              onClick={() =>
                setShowShare(true)
              }
            >
              SHARE
            </button>{" "}

            <button
              onClick={leaveSession}
            >
              LEAVE
            </button>
          </p>
        </div>

        <button
          className="icon"
          onClick={() =>
            setDark((value) => !value)
          }
          aria-label="Toggle theme"
        >
          {dark ? "☀" : "◐"}
        </button>
      </header>

      {/* RACE TIMER */}

      <section className="hero">
        <div>
          <span>RACE ELAPSED</span>

          <strong>
            {fmt(elapsed)}
          </strong>
        </div>

        <div>
          <span>TIME REMAINING</span>

          <strong>
            {fmt(timeRemaining)}
          </strong>
        </div>

        <div className="controls">
          <button
            className="primary"
            disabled={
              activeRace.status ===
              "running"
            }
            onClick={() => {
              void startRace();
            }}
          >
            {activeRace.status === "running"
              ? "RUNNING"
              : activeRace.status === "paused"
              ? "RESUME"
              : "START"}
          </button>

          <button
            disabled={
              activeRace.status !==
              "running"
            }
            onClick={() => {
              void pauseRace();
            }}
          >
            PAUSE
          </button>

          <button
            className="danger"
            onClick={() => {
              void resetRace();
            }}
          >
            RESET
          </button>
        </div>
      </section>

      <section className="grid">

        {/* CURRENT DRIVER */}

        <article className="card current">
          <span>CURRENT DRIVER</span>

          <h2>
            {currentDriver?.name ??
              "Add a driver"}
          </h2>

          <b>
            STINT {fmt(stint)}
          </b>

          <div className="swap">
            <button
              onClick={() => {
                void swap("battery_swap");
              }}
            >
              🔋 BATTERY SWAP
            </button>

            <button
              disabled={queue.length === 0}
              onClick={() => {
                void swap("driver_swap");
              }}
            >
              👤 DRIVER SWAP
            </button>

            <button
              className="full"
              disabled={queue.length === 0}
              onClick={() => {
                void swap("full_swap");
              }}
            >
              🔋 + 👤 FULL CHANGE
            </button>
          </div>
        </article>

        {/* ACTIVITY TRACKER */}

        <article className="card activity">
          <div className="titleRow">
            <span>ACTIVITY TRACKER</span>

            <small>
              DRIVE → MARSHAL → PIT → REST
            </small>
          </div>

          <div className="activityList">
            {drivers.length === 0 && (
              <p className="muted">
                Add drivers to see the
                activity rotation.
              </p>
            )}

            {drivers.map((driver) => {
              const activity =
                getActivityForDriver(
                  driver.id
                );

              const isCurrentDriver =
                driver.id ===
                activeRace.current_driver_id;

              return (
                <div
                  className={`activityRow ${
                    activity.className
                  } ${
                    isCurrentDriver
                      ? "activeDriver"
                      : ""
                  }`}
                  key={driver.id}
                >
                  <div>
                    <strong>
                      {driver.name}
                    </strong>

                    {isCurrentDriver && (
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
            })}
          </div>
        </article>

        {/* DRIVER QUEUE */}

        <article className="card">
          <div className="titleRow">
            <span>DRIVER QUEUE</span>

            <small>
              {queue.length} queued
            </small>
          </div>

          {queue.length === 0 ? (
            <p className="muted">
              Add drivers below. Drivers can
              appear multiple times.
            </p>
          ) : (
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
                    <li key={queueItem.id}>
                      <b>
                        {index + 1}
                      </b>

                      <span>
                        {driver?.name ??
                          "Unknown driver"}
                      </span>

                      <button
                        onClick={() => {
                          void removeQueue(
                            queueItem.id
                          );
                        }}
                        aria-label="Remove from queue"
                      >
                        ×
                      </button>
                    </li>
                  );
                }
              )}
            </ol>
          )}

          <div className="add">
            {drivers.map((driver) => (
              <button
                key={driver.id}
                onClick={() => {
                  void addQueue(driver.id);
                }}
              >
                + {driver.name}
              </button>
            ))}
          </div>
        </article>

        {/* DRIVERS */}

        <article className="card">
          <div className="titleRow">
            <span>DRIVERS</span>

            <small>
              {drivers.length} drivers
            </small>
          </div>

          <div className="addDriver">
            <input
              value={newDriver}
              onChange={(event) =>
                setNewDriver(
                  event.target.value
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void addDriver();
                }
              }}
              placeholder="Driver name"
            />

            <button
              disabled={!newDriver.trim()}
              onClick={() => {
                void addDriver();
              }}
            >
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
                onClick={() => {
                  void setCurrentDriver(
                    driver.id
                  );
                }}
              >
                {driver.name}
              </button>

              <button
                onClick={() => {
                  void editDriver(driver);
                }}
                aria-label={`Edit ${driver.name}`}
              >
                ✎
              </button>
            </div>
          ))}
        </article>

        {/* SESSION STATUS */}

        <article className="card history">
          <span>SESSION STATUS</span>

          <p>
            Status:{" "}
            <b>
              {activeRace.status.toUpperCase()}
            </b>
          </p>

          <p>
            Session code:{" "}
            <b>
              {activeSession.session_code}
            </b>
          </p>

          <button
            onClick={() =>
              setShowShare(true)
            }
          >
            SHARE SESSION
          </button>

          {message && (
            <p className="message">
              {message}
            </p>
          )}
        </article>
      </section>

      {/* SHARE MODAL */}

      {showShare && (
        <div
          className="shareOverlay"
          onClick={() =>
            setShowShare(false)
          }
        >
          <div
            className="shareModal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="shareHeader">
              <div>
                <span>SHARE SESSION</span>

                <h2>
                  {activeSession.session_code}
                </h2>
              </div>

              <button
                className="closeButton"
                onClick={() =>
                  setShowShare(false)
                }
                aria-label="Close share window"
              >
                ×
              </button>
            </div>

            <p className="muted">
              Copy the link or scan the QR
              code on another phone or tablet
              to join this live race session.
            </p>

            <div className="shareActions">
              <button
                className="primary"
                onClick={() => {
                  void copyShareLink();
                }}
              >
                📋 COPY SHARE LINK
              </button>
            </div>

            <div className="shareLink">
              {shareLink}
            </div>

            <div className="qrSection">
              <p>SCAN TO JOIN</p>

              <div className="qrCode">
                <QRCodeSVG
                  value={shareLink}
                  size={220}
                  level="M"
                  includeMargin={true}
                />
              </div>
            </div>

            <button
              className="closeShareButton"
              onClick={() =>
                setShowShare(false)
              }
            >
              CLOSE
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
