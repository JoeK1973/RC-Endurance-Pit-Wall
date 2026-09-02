"use client";

import { useEffect, useRef, useState } from "react";
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
  const safeSeconds = Math.max(0, Math.floor(seconds));

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(
    minutes
  ).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const secondsSince = (iso: string | null, now: number) => {
  if (!iso) return 0;

  return Math.max(
    0,
    Math.floor((now - new Date(iso).getTime()) / 1000)
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

  /*
   * Initialise Supabase
   */
  useEffect(() => {
    if (hasSupabase()) {
      supabase.current = createClient();
    }
  }, []);

  /*
   * Live clock
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
   * Theme
   */
  useEffect(() => {
    document.documentElement.dataset.theme = dark
      ? "dark"
      : "light";
  }, [dark]);

  /*
   * Load session from Supabase
   */
  const loadSession = async (code: string) => {
    const db = supabase.current;

    if (!db) {
      setMessage(
        "Supabase is not configured."
      );
      return;
    }

    setLoading(true);
    setMessage("");

    const normalizedCode = code
      .trim()
      .toUpperCase();

    const {
      data: sessionData,
      error: sessionError,
    } = await db
      .from("race_sessions")
      .select("*")
      .eq(
        "session_code",
        normalizedCode
      )
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
      .eq(
        "session_id",
        sessionData.id
      )
      .single();

    if (raceError || !raceData) {
      setLoading(false);

      setMessage(
        raceError?.message ??
          "Race data could not be loaded."
      );

      return;
    }

    const { data: driverData } = await db
      .from("drivers")
      .select("*")
      .eq(
        "session_id",
        sessionData.id
      )
      .order("created_at");

    const { data: queueData } = await db
      .from("driver_queue")
      .select(
        "id, driver_id, position"
      )
      .eq(
        "session_id",
        sessionData.id
      )
      .order("position");

    const loadedSession: Session = {
      id: sessionData.id,
      session_code:
        sessionData.session_code,
    };

    const loadedRace: Race = {
      id: raceData.id,
      session_id: raceData.session_id,
      duration_seconds:
        raceData.duration_seconds,
      status:
        raceData.status as RaceStatus,
      started_at:
        raceData.started_at,
      paused_at:
        raceData.paused_at,
      accumulated_pause_seconds:
        raceData.accumulated_pause_seconds ??
        0,
      current_driver_id:
        raceData.current_driver_id,
      current_stint_started_at:
        raceData.current_stint_started_at,
      activity_rotation:
        raceData.activity_rotation ??
        0,
    };

    setSession(loadedSession);
    setRace(loadedRace);
    setDrivers(driverData ?? []);
    setQueue(queueData ?? []);

    setLoading(false);

    window.history.replaceState(
      null,
      "",
      `/?session=${loadedSession.session_code}`
    );
  };

  /*
   * Load a session code from the URL
   */
  useEffect(() => {
    if (!supabase.current) return;

    const params = new URLSearchParams(
      window.location.search
    );

    const sessionCode =
      params.get("session");

    if (sessionCode) {
      void loadSession(sessionCode);
    }
  }, []);

  /*
   * Realtime updates
   */
  useEffect(() => {
    if (!session) return;

    const db = supabase.current;

    if (!db) return;

    const refreshSession = () => {
      void loadSession(
        session.session_code
      );
    };

    const channel = db
      .channel(
        `race-session-${session.id}`
      )
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
      void db.removeChannel(channel);
    };
  }, [session?.id, session?.session_code]);

  /*
   * Create session
   */
  const createSession = async () => {
    const db = supabase.current;

    if (!db) {
      setMessage(
        "Supabase is not configured."
      );
      return;
    }

    setLoading(true);
    setMessage("");

    const {
      data,
      error,
    } = await db.rpc(
      "create_race_session"
    );

    if (error || !data) {
      setLoading(false);

      setMessage(
        error?.message ??
          "Could not create session."
      );

      return;
    }

    await loadSession(
      data.session_code
    );
  };

  /*
   * Add driver
   */
  const addDriver = async () => {
    const currentSession = session;
    const currentRace = race;
    const driverName =
      newDriver.trim();

    if (
      !currentSession ||
      !currentRace ||
      !driverName
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
        session_id:
          currentSession.id,
        name: driverName,
      })
      .select()
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    if (!data) return;

    setNewDriver("");

    if (
      !currentRace.current_driver_id
    ) {
      const { error: updateError } =
        await db
          .from("races")
          .update({
            current_driver_id:
              data.id,
            current_stint_started_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            currentRace.id
          );

      if (updateError) {
        setMessage(
          updateError.message
        );
      }
    }
  };

  /*
   * Edit driver
   */
  const editDriver = async (
    driver: Driver
  ) => {
    const updatedName = prompt(
      "Driver name",
      driver.name
    );

    if (!updatedName?.trim()) {
      return;
    }

    const db = supabase.current;

    if (!db) return;

    const { error } = await db
      .from("drivers")
      .update({
        name: updatedName.trim(),
      })
      .eq("id", driver.id);

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Add to queue.
   *
   * Duplicate entries are allowed.
   */
  const addQueue = async (
    driverId: string
  ) => {
    const currentSession = session;

    if (!currentSession) return;

    const db = supabase.current;

    if (!db) return;

    const highestPosition =
      queue.reduce(
        (highest, item) =>
          Math.max(
            highest,
            item.position
          ),
        0
      );

    const { error } = await db
      .from("driver_queue")
      .insert({
        session_id:
          currentSession.id,
        driver_id: driverId,
        position:
          highestPosition + 1,
      });

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Remove one queue entry.
   *
   * This uses the queue entry ID rather
   * than the driver ID, so duplicates
   * work correctly.
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
   * Update race
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
      .eq(
        "id",
        currentRace.id
      );

    if (error) {
      setMessage(error.message);
    }
  };

  /*
   * Start / resume
   */
  const startRace = async () => {
    const currentRace = race;

    if (!currentRace) return;

    const nowIso =
      new Date().toISOString();

    if (
      currentRace.status === "idle"
    ) {
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
      currentRace.status ===
        "paused" &&
      currentRace.paused_at
    ) {
      const pauseSeconds =
        Math.max(
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
          pauseSeconds,
      });
    }
  };

  /*
   * Pause
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
      paused_at:
        new Date().toISOString(),
    });
  };

  /*
   * Reset
   */
  const resetRace = async () => {
    const currentRace = race;

    if (!currentRace) return;

    const confirmed =
      window.confirm(
        "Are you sure you want to reset this race?"
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
   * Battery swap / driver swap /
   * combined full change
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

    const firstQueueItem =
      queue.length > 0
        ? queue[0]
        : null;

    let incomingDriverId =
      currentRace.current_driver_id;

    /*
     * Driver changes require a driver
     * at the front of the queue.
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
       * Remove only this queue entry.
       */
      const {
        error: deleteError,
      } = await db
        .from("driver_queue")
        .delete()
        .eq(
          "id",
          firstQueueItem.id
        );

      if (deleteError) {
        setMessage(
          deleteError.message
        );

        return;
      }

      /*
       * Put outgoing driver at the
       * back of the queue.
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

        const { error: insertError } =
          await db
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
     * Record activity
     */
    const {
      error: eventError,
    } = await db
      .from("race_events")
      .insert({
        session_id:
          currentSession.id,
        event_type: type,
        outgoing_driver_id:
          currentRace.current_driver_id,
        incoming_driver_id:
          incomingDriverId,
      });

    if (eventError) {
      setMessage(
        eventError.message
      );
    }

    /*
     * Every battery change starts a new
     * stint. A driver change also moves
     * the current driver.
     */
    const raceUpdates: Partial<Race> =
      {
        current_driver_id:
          incomingDriverId,
        current_stint_started_at:
          new Date().toISOString(),
      };

    if (type !== "battery_swap") {
      raceUpdates.activity_rotation =
        currentRace.activity_rotation +
        1;
    }

    await updateRace(raceUpdates);
  };

  /*
   * Race elapsed time
   */
  const elapsed = (() => {
    if (!race?.started_at) {
      return 0;
    }

    const startedAt =
      new Date(
        race.started_at
      ).getTime();

    let totalSeconds =
      Math.floor(
        (now - startedAt) / 1000
      ) -
      race.accumulated_pause_seconds;

    if (
      race.status === "paused" &&
      race.paused_at
    ) {
      const pauseStartedAt =
        new Date(
          race.paused_at
        ).getTime();

      totalSeconds -= Math.floor(
        (now - pauseStartedAt) /
          1000
      );
    }

    return Math.max(
      0,
      totalSeconds
    );
  })();

  /*
   * Stint time
   */
  const stint = secondsSince(
    race?.current_stint_started_at ??
      null,
    now
  );

  /*
   * Current driver
   */
  const currentDriver =
    drivers.find(
      (driver) =>
        driver.id ===
        race?.current_driver_id
    ) ?? null;

  /*
   * Activity tracker.
   *
   * The current driver is Drive.
   *
   * Looking forward through the driver
   * list from the current driver:
   *
   * Drive -> Rest -> Pit -> Marshal
   *
   * This produces:
   *
   * Driver 1 current:
   * D1 Drive
   * D2 Rest
   * D3 Pit
   * D4 Marshal
   *
   * Driver 2 current:
   * D1 Marshal
   * D2 Drive
   * D3 Rest
   * D4 Pit
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
          driver.id ===
          currentDriverId
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
   * Set a driver manually.
   *
   * Useful before the race starts.
   */
  const setCurrentDriver = async (
    driverId: string
  ) => {
    const currentRace = race;

    if (!currentRace) return;

    await updateRace({
      current_driver_id:
        driverId,
      current_stint_started_at:
        new Date().toISOString(),
    });
  };

  /*
   * Copy share code
   */
  const copyShareCode = async () => {
    if (!session) return;

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
   * Leave session
   */
  const leaveSession = () => {
    setSession(null);
    setRace(null);
    setDrivers([]);
    setQueue([]);
    setMessage("");

    window.history.replaceState(
      null,
      "",
      "/"
    );
  };

  /*
   * JOIN / CREATE SCREEN
   */
  if (!session || !race) {
    return (
      <main>
        <header>
          <div>
            <h1>
              RC ENDURANCE
            </h1>

            <p>
              Create or join a live race
              session.
            </p>
          </div>

          <button
            className="icon"
            onClick={() =>
              setDark(
                (value) => !value
              )
            }
            aria-label="Toggle theme"
          >
            {dark ? "☀" : "◐"}
          </button>
        </header>

        <section className="welcome">
          <h2>
            CREATE OR JOIN
          </h2>

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
                  !loading
                ) {
                  void loadSession(
                    joinCode
                  );
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
                void loadSession(
                  joinCode
                );
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
   * race is guaranteed non-null below
   * because of the return above.
   */
  const activeRace = race;

  const timeRemaining =
    Math.max(
      0,
      activeRace.duration_seconds -
        elapsed
    );

  return (
    <main>
      <header>
        <div>
          <h1>
            RC ENDURANCE
          </h1>

          <p>
            Session{" "}
            <b>
              {session.session_code}
            </b>{" "}

            <button
              onClick={() => {
                void copyShareCode();
              }}
            >
              COPY CODE
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
            setDark(
              (value) => !value
            )
          }
          aria-label="Toggle theme"
        >
          {dark ? "☀" : "◐"}
        </button>
      </header>

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
            {activeRace.status ===
            "running"
              ? "RUNNING"
              : activeRace.status ===
                "paused"
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
              onClick={() => {
                void swap(
                  "battery_swap"
                );
              }}
            >
              🔋 BATTERY SWAP
            </button>

            <button
              disabled={
                queue.length === 0
              }
              onClick={() => {
                void swap(
                  "driver_swap"
                );
              }}
            >
              👤 DRIVER SWAP
            </button>

            <button
              className="full"
              disabled={
                queue.length === 0
              }
              onClick={() => {
                void swap(
                  "full_swap"
                );
              }}
            >
              🔋 + 👤 FULL CHANGE
            </button>
          </div>
        </article>

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
            {drivers.length === 0 && (
              <p className="muted">
                Add drivers to see the
                activity rotation.
              </p>
            )}

            {drivers.map(
              (driver) => {
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
              }
            )}
          </div>
        </article>

        <article className="card">
          <div className="titleRow">
            <span>
              DRIVER QUEUE
            </span>

            <small>
              {queue.length} queued
            </small>
          </div>

          {queue.length === 0 ? (
            <p className="muted">
              Add drivers below. The same
              driver can be added multiple
              times.
            </p>
          ) : (
            <ol>
              {queue.map(
                (
                  queueItem,
                  index
                ) => {
                  const driver =
                    drivers.find(
                      (item) =>
                        item.id ===
                        queueItem.driver_id
                    );

                  return (
                    <li
                      key={
                        queueItem.id
                      }
                    >
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
            {drivers.map(
              (driver) => (
                <button
                  key={driver.id}
                  onClick={() => {
                    void addQueue(
                      driver.id
                    );
                  }}
                >
                  + {driver.name}
                </button>
              )
            )}
          </div>
        </article>

        <article className="card">
          <div className="titleRow">
            <span>
              DRIVERS
            </span>

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
                if (
                  event.key === "Enter"
                ) {
                  void addDriver();
                }
              }}
              placeholder="Driver name"
            />

            <button
              disabled={
                !newDriver.trim()
              }
              onClick={() => {
                void addDriver();
              }}
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
                    void editDriver(
                      driver
                    );
                  }}
                  aria-label={`Edit ${driver.name}`}
                >
                  ✎
                </button>
              </div>
            )
          )}
        </article>

        <article className="card history">
          <span>
            SESSION STATUS
          </span>

          <p>
            Status:{" "}
            <b>
              {activeRace.status.toUpperCase()}
            </b>
          </p>

          <p>
            Session code:{" "}
            <b>
              {session.session_code}
            </b>
          </p>

          <p className="muted">
            Open this session on another
            device using the same code.
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
