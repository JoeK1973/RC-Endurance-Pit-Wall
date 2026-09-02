"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { QRCodeSVG } from "qrcode.react";
import {
  createClient,
  hasSupabase,
} from "@/lib/supabase/client";

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

type RaceStatus =
  | "idle"
  | "running"
  | "paused"
  | "finished";

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
  active_stint_id: string | null;
};

type Activity = {
  name: string;
  icon: string;
  className: string;
};

type LiveResultsConfig = {
  id: string;
  session_id: string;
  race_url: string;
  team_name: string | null;
  enabled: boolean;
};

type LiveTeam = {
  name: string;
  position?: number | null;
  laps?: number | null;
  lastLap?: number | null;
  bestLap?: number | null;
  averageLap?: number | null;
  driverResultUrl?: string | null;
};

type LiveLap = {
  lapNumber: number;
  lapTime: number;
};

type RaceLap = {
  id: string;
  session_id: string;
  stint_id: string | null;
  driver_id: string | null;
  lap_number: number;
  lap_time_seconds: number;
  completed_at: string;
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
  const safe = Math.max(
    0,
    Math.floor(seconds)
  );

  const hours = Math.floor(
    safe / 3600
  );

  const minutes = Math.floor(
    (safe % 3600) / 60
  );

  const secs = safe % 60;

  return `${String(hours).padStart(
    2,
    "0"
  )}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(
    2,
    "0"
  )}`;
};

const fmtLap = (
  seconds: number | null | undefined
) => {
  if (
    seconds === null ||
    seconds === undefined ||
    !Number.isFinite(seconds)
  ) {
    return "--.---";
  }

  const minutes = Math.floor(
    seconds / 60
  );

  const remainder =
    seconds - minutes * 60;

  if (minutes > 0) {
    return `${minutes}:${remainder
      .toFixed(3)
      .padStart(6, "0")}`;
  }

  return seconds.toFixed(3);
};

const secondsSince = (
  iso: string | null,
  now: number
) => {
  if (!iso) return 0;

  const start = new Date(
    iso
  ).getTime();

  if (Number.isNaN(start)) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(
      (now - start) / 1000
    )
  );
};

export default function Home() {
  const supabase = useRef<any>(null);

  const [session, setSession] =
    useState<Session | null>(null);

  const [race, setRace] =
    useState<Race | null>(null);

  const [drivers, setDrivers] =
    useState<Driver[]>([]);

  const [queue, setQueue] =
    useState<QueueItem[]>([]);

  const [
    liveResultsConfig,
    setLiveResultsConfig,
  ] =
    useState<LiveResultsConfig | null>(
      null
    );

  const [liveTeams, setLiveTeams] =
    useState<LiveTeam[]>([]);

  const [liveTeam, setLiveTeam] =
    useState<LiveTeam | null>(null);

  const [liveLaps, setLiveLaps] =
    useState<LiveLap[]>([]);

  const [raceLaps, setRaceLaps] =
    useState<RaceLap[]>([]);

  const [rcResultsUrl, setRcResultsUrl] =
    useState("");

  const [
    selectedTeamName,
    setSelectedTeamName,
  ] = useState("");

  const [
    connectingLiveResults,
    setConnectingLiveResults,
  ] = useState(false);

  const [joinCode, setJoinCode] =
    useState("");

  const [newDriver, setNewDriver] =
    useState("");

  const [now, setNow] =
    useState(Date.now());

  const [dark, setDark] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [showShare, setShowShare] =
    useState(false);

  /*
   * Initialise Supabase.
   */
  useEffect(() => {
    if (hasSupabase()) {
      supabase.current =
        createClient();
    }
  }, []);

  /*
   * Update visible timers.
   */
  useEffect(() => {
    const timer =
      window.setInterval(() => {
        setNow(Date.now());
      }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  /*
   * Apply light/dark theme.
   */
  useEffect(() => {
    document.documentElement.dataset.theme =
      dark
        ? "dark"
        : "light";
  }, [dark]);

  /*
   * Load all data belonging to a session.
   */
  const loadSession = useCallback(
    async (code: string) => {
      const db =
        supabase.current;

      if (!db) {
        setMessage(
          "Supabase is not configured."
        );
        return;
      }

      const normalizedCode =
        code.trim().toUpperCase();

      if (!normalizedCode) {
        return;
      }

      setLoading(true);

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

      if (
        sessionError ||
        !sessionData
      ) {
        setLoading(false);

        setMessage(
          sessionError?.message ??
            "Session not found."
        );

        return;
      }

      const [
        raceResult,
        driverResult,
        queueResult,
        liveConfigResult,
        lapsResult,
      ] = await Promise.all([
        db
          .from("races")
          .select("*")
          .eq(
            "session_id",
            sessionData.id
          )
          .single(),

        db
          .from("drivers")
          .select("*")
          .eq(
            "session_id",
            sessionData.id
          )
          .order(
            "created_at",
            {
              ascending: true,
            }
          ),

        db
          .from("driver_queue")
          .select(
            "id, driver_id, position"
          )
          .eq(
            "session_id",
            sessionData.id
          )
          .order(
            "position",
            {
              ascending: true,
            }
          ),

        db
          .from(
            "live_results_config"
          )
          .select("*")
          .eq(
            "session_id",
            sessionData.id
          )
          .maybeSingle(),

        db
          .from("race_laps")
          .select("*")
          .eq(
            "session_id",
            sessionData.id
          )
          .order(
            "lap_number",
            {
              ascending: true,
            }
          ),
      ]);

      if (
        raceResult.error ||
        !raceResult.data
      ) {
        setLoading(false);

        setMessage(
          raceResult.error?.message ??
            "Race data could not be loaded."
        );

        return;
      }

      const raceData =
        raceResult.data;

      const loadedSession: Session = {
        id: sessionData.id,
        session_code:
          sessionData.session_code,
      };

      const loadedRace: Race = {
        id: raceData.id,
        session_id:
          raceData.session_id,

        duration_seconds: Number(
          raceData.duration_seconds ??
            0
        ),

        status:
          raceData.status as RaceStatus,

        started_at:
          raceData.started_at ??
          null,

        paused_at:
          raceData.paused_at ??
          null,

        accumulated_pause_seconds:
          Number(
            raceData.accumulated_pause_seconds ??
              0
          ),

        current_driver_id:
          raceData.current_driver_id ??
          null,

        current_stint_started_at:
          raceData.current_stint_started_at ??
          null,

        activity_rotation:
          Number(
            raceData.activity_rotation ??
              0
          ),

        active_stint_id:
          raceData.active_stint_id ??
          null,
      };

      setSession(
        loadedSession
      );

      setRace(
        loadedRace
      );

      setDrivers(
        driverResult.data ?? []
      );

      setQueue(
        queueResult.data ?? []
      );

      setLiveResultsConfig(
        liveConfigResult.data ??
          null
      );

      if (
        liveConfigResult.data?.race_url
      ) {
        setRcResultsUrl(
          liveConfigResult.data
            .race_url
        );
      }

      if (
        liveConfigResult.data?.team_name
      ) {
        setSelectedTeamName(
          liveConfigResult.data
            .team_name
        );
      }

      setRaceLaps(
        lapsResult.data ?? []
      );

      setLoading(false);

      if (
        typeof window !==
        "undefined"
      ) {
        window.history.replaceState(
          null,
          "",
          `/?session=${loadedSession.session_code}`
        );
      }
    },
    []
  );

  /*
   * Load shared session.
   */
  useEffect(() => {
    if (!supabase.current) {
      return;
    }

    const params =
      new URLSearchParams(
        window.location.search
      );

    const sessionCode =
      params.get("session");

    if (sessionCode) {
      void loadSession(
        sessionCode
      );
    }
  }, [loadSession]);

  /*
   * Supabase realtime updates.
   */
  useEffect(() => {
    if (!session) return;

    const db =
      supabase.current;

    if (!db) return;

    const sessionId =
      session.id;

    const sessionCode =
      session.session_code;

    const refresh = () => {
      void loadSession(
        sessionCode
      );
    };

    const channel = db
      .channel(
        `race-session-${sessionId}`
      )
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table:
            "live_results_config",
          filter: `session_id=eq.${sessionId}`,
        },
        refresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "race_laps",
          filter: `session_id=eq.${sessionId}`,
        },
        refresh
      )
      .subscribe();

    return () => {
      void db.removeChannel(
        channel
      );
    };
  }, [session, loadSession]);

  /*
   * Create a new session.
   */
  const createSession =
    async () => {
      const db =
        supabase.current;

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

      if (
        error ||
        !data
      ) {
        setLoading(false);

        setMessage(
          error?.message ??
            "Could not create a session."
        );

        return;
      }

      await loadSession(
        data.session_code
      );
    };

  /*
   * Add driver.
   */
  const addDriver =
    async () => {
      const currentSession =
        session;

      const currentRace =
        race;

      const name =
        newDriver.trim();

      if (
        !currentSession ||
        !currentRace ||
        !name
      ) {
        return;
      }

      const db =
        supabase.current;

      if (!db) return;

      const {
        data,
        error,
      } = await db
        .from("drivers")
        .insert({
          session_id:
            currentSession.id,
          name,
        })
        .select()
        .single();

      if (error) {
        setMessage(
          error.message
        );
        return;
      }

      if (!data) return;

      setNewDriver("");

      /*
       * First driver becomes
       * current driver.
       */
      if (
        !currentRace.current_driver_id
      ) {
        const nowIso =
          new Date().toISOString();

        const {
          data: newStint,
          error: stintError,
        } = await db
          .from("driver_stints")
          .insert({
            session_id:
              currentSession.id,
            driver_id: data.id,
            started_at: nowIso,
            start_lap:
              raceLaps.length,
          })
          .select()
          .single();

        if (stintError) {
          setMessage(
            stintError.message
          );
          return;
        }

        await db
          .from("races")
          .update({
            current_driver_id:
              data.id,

            current_stint_started_at:
              nowIso,

            active_stint_id:
              newStint?.id ??
              null,
          })
          .eq(
            "id",
            currentRace.id
          );
      }
    };

  /*
   * Edit driver.
   */
  const editDriver =
    async (
      driver: Driver
    ) => {
      const name = prompt(
        "Driver name",
        driver.name
      );

      if (!name?.trim()) {
        return;
      }

      const db =
        supabase.current;

      if (!db) return;

      const { error } =
        await db
          .from("drivers")
          .update({
            name: name.trim(),
          })
          .eq(
            "id",
            driver.id
          );

      if (error) {
        setMessage(
          error.message
        );
      }
    };

  /*
   * Add driver to queue.
   * Duplicate entries allowed.
   */
  const addQueue =
    async (
      driverId: string
    ) => {
      const currentSession =
        session;

      if (!currentSession) {
        return;
      }

      const db =
        supabase.current;

      if (!db) return;

      const highestPosition =
        queue.reduce(
          (
            highest,
            item
          ) =>
            Math.max(
              highest,
              item.position
            ),
          0
        );

      const { error } =
        await db
          .from("driver_queue")
          .insert({
            session_id:
              currentSession.id,
            driver_id:
              driverId,
            position:
              highestPosition + 1,
          });

      if (error) {
        setMessage(
          error.message
        );
      }
    };

  /*
   * Remove exactly one queue entry.
   */
  const removeQueue =
    async (
      queueItemId: string
    ) => {
      const db =
        supabase.current;

      if (!db) return;

      const { error } =
        await db
          .from("driver_queue")
          .delete()
          .eq(
            "id",
            queueItemId
          );

      if (error) {
        setMessage(
          error.message
        );
      }
    };

  /*
   * Update race safely.
   */
  const updateRace =
    async (
      updates: Partial<Race>
    ) => {
      const currentRace =
        race;

      if (!currentRace) {
        return;
      }

      const db =
        supabase.current;

      if (!db) return;

      const { error } =
        await db
          .from("races")
          .update(updates)
          .eq(
            "id",
            currentRace.id
          );

      if (error) {
        setMessage(
          error.message
        );
      }
    };

  /*
   * Start/resume race.
   */
  const startRace =
    async () => {
      const currentRace =
        race;

      if (!currentRace) {
        return;
      }

      const nowIso =
        new Date().toISOString();

      if (
        currentRace.status ===
        "idle"
      ) {
        await updateRace({
          status: "running",
          started_at: nowIso,
          paused_at: null,
          accumulated_pause_seconds:
            0,
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
        const pausedFor =
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
            pausedFor,
        });
      }
    };

  /*
   * Pause race.
   */
  const pauseRace =
    async () => {
      const currentRace =
        race;

      if (
        !currentRace ||
        currentRace.status !==
          "running"
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
   * Reset race.
   */
  const resetRace =
    async () => {
      const currentRace =
        race;

      const currentSession =
        session;

      if (
        !currentRace ||
        !currentSession
      ) {
        return;
      }

      const confirmed =
        window.confirm(
          "Are you sure you want to reset the race timer? Existing RC-Results lap data will remain stored."
        );

      if (!confirmed) return;

      await updateRace({
        status: "idle",
        started_at: null,
        paused_at: null,
        accumulated_pause_seconds:
          0,
        current_stint_started_at:
          null,
        activity_rotation: 0,
        active_stint_id: null,
      });
    };

  /*
   * Close the current
   * driver stint.
   */
  const closeCurrentStint =
    async () => {
      const currentRace =
        race;

      if (
        !currentRace?.active_stint_id
      ) {
        return;
      }

      const db =
        supabase.current;

      if (!db) return;

      await db
        .from("driver_stints")
        .update({
          ended_at:
            new Date().toISOString(),

          end_lap:
            raceLaps.length,
        })
        .eq(
          "id",
          currentRace.active_stint_id
        );
    };

  /*
   * Create a new driver stint.
   */
  const createDriverStint =
    async (
      driverId: string
    ) => {
      const currentSession =
        session;

      const currentRace =
        race;

      if (
        !currentSession ||
        !currentRace
      ) {
        return;
      }

      const db =
        supabase.current;

      if (!db) return;

      const nowIso =
        new Date().toISOString();

      const {
        data,
        error,
      } = await db
        .from("driver_stints")
        .insert({
          session_id:
            currentSession.id,

          driver_id:
            driverId,

          started_at:
            nowIso,

          start_lap:
            raceLaps.length,
        })
        .select()
        .single();

      if (
        error ||
        !data
      ) {
        setMessage(
          error?.message ??
            "Could not create driver stint."
        );

        return;
      }

      await db
        .from("races")
        .update({
          current_driver_id:
            driverId,

          current_stint_started_at:
            nowIso,

          active_stint_id:
            data.id,
        })
        .eq(
          "id",
          currentRace.id
        );
    };

  /*
   * Battery swap,
   * driver swap or both.
   */
  const swap =
    async (
      type:
        | "battery_swap"
        | "driver_swap"
        | "full_swap"
    ) => {
      const currentSession =
        session;

      const currentRace =
        race;

      if (
        !currentSession ||
        !currentRace
      ) {
        return;
      }

      const db =
        supabase.current;

      if (!db) return;

      setMessage("");

      let incomingDriverId =
        currentRace.current_driver_id;

      const firstQueueItem =
        queue.length > 0
          ? queue[0]
          : null;

      /*
       * Driver change.
       */
      if (
        type !==
        "battery_swap"
      ) {
        if (!firstQueueItem) {
          setMessage(
            "There is no driver in the queue."
          );

          return;
        }

        incomingDriverId =
          firstQueueItem.driver_id;

        /*
         * Close outgoing stint.
         */
        await closeCurrentStint();

        /*
         * Remove exact queue entry.
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
         * Add outgoing driver
         * to the back of queue.
         */
        if (
          currentRace.current_driver_id
        ) {
          const highestPosition =
            queue.reduce(
              (
                highest,
                item
              ) =>
                Math.max(
                  highest,
                  item.position
                ),
              0
            );

          const {
            error: insertError,
          } = await db
            .from(
              "driver_queue"
            )
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
       * Save event.
       */
      const {
        error: eventError,
      } = await db
        .from("race_events")
        .insert({
          session_id:
            currentSession.id,

          event_type:
            type,

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
       * Battery-only swap
       * does not change driver.
       */
      if (
        type ===
        "battery_swap"
      ) {
        await updateRace({
          current_stint_started_at:
            new Date().toISOString(),
        });

        return;
      }

      if (incomingDriverId) {
        const nowIso =
          new Date().toISOString();

        const {
          data: newStint,
          error: stintError,
        } = await db
          .from("driver_stints")
          .insert({
            session_id:
              currentSession.id,

            driver_id:
              incomingDriverId,

            started_at:
              nowIso,

            start_lap:
              raceLaps.length,
          })
          .select()
          .single();

        if (stintError) {
          setMessage(
            stintError.message
          );

          return;
        }

        await db
          .from("races")
          .update({
            current_driver_id:
              incomingDriverId,

            current_stint_started_at:
              nowIso,

            activity_rotation:
              currentRace.activity_rotation +
              1,

            active_stint_id:
              newStint?.id ??
              null,
          })
          .eq(
            "id",
            currentRace.id
          );
      }
    };

  /*
   * Manually set current driver.
   */
  const setCurrentDriver =
    async (
      driverId: string
    ) => {
      const currentRace =
        race;

      if (!currentRace) {
        return;
      }

      if (
        currentRace.current_driver_id ===
        driverId
      ) {
        return;
      }

      await closeCurrentStint();

      await createDriverStint(
        driverId
      );
    };

  /*
   * Connect to RC-Results
   * and discover teams.
   */
  const connectLiveResults =
    async () => {
      const url =
        rcResultsUrl.trim();

      if (!url) {
        setMessage(
          "Enter an RC-Results URL first."
        );

        return;
      }

      setConnectingLiveResults(
        true
      );

      setMessage("");

      try {
        const response =
          await fetch(
            `/api/rc-results?url=${encodeURIComponent(
              url
            )}`,
            {
              cache: "no-store",
            }
          );

        const contentType =
          response.headers.get("content-type") ?? "";

        if (
          !contentType.includes("application/json")
        ) {
          const text =
            await response.text();

          console.error(
            "RC-Results API returned non-JSON:",
            text
          );

          throw new Error(
            "The RC-Results API route returned HTML instead of JSON. Check that app/api/rc-results/route.ts exists and has deployed successfully."
          );
        }

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ??
              "Could not read RC-Results."
          );
        }

        const teams =
          data.teams ?? [];

        setLiveTeams(
          teams
        );

        if (
          teams.length === 0
        ) {
          setMessage(
            data.message ??
              "No teams were found. Try the exact RC-Results live race URL."
          );
        } else {
          setMessage(
            `${teams.length} team${
              teams.length === 1
                ? ""
                : "s"
            } found. Select your team.`
          );
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not connect to RC-Results."
        );
      } finally {
        setConnectingLiveResults(
          false
        );
      }
    };

  /*
   * Save selected RC team.
   */
  const saveLiveResultsTeam =
    async () => {
      const currentSession =
        session;

      const url =
        rcResultsUrl.trim();

      if (
        !currentSession ||
        !url ||
        !selectedTeamName
      ) {
        return;
      }

      const db =
        supabase.current;

      if (!db) return;

      const {
        data,
        error,
      } = await db
        .from(
          "live_results_config"
        )
        .upsert(
          {
            session_id:
              currentSession.id,

            race_url:
              url,

            team_name:
              selectedTeamName,

            enabled:
              true,
          },
          {
            onConflict:
              "session_id",
          }
        )
        .select()
        .single();

      if (error) {
        setMessage(
          error.message
        );

        return;
      }

      setLiveResultsConfig(
        data
      );

      setMessage(
        `Now tracking ${selectedTeamName}.`
      );
    };

  /*
   * Stop RC-Results tracking.
   */
  const disconnectLiveResults =
    async () => {
      const currentConfig =
        liveResultsConfig;

      if (!currentConfig) {
        return;
      }

      const db =
        supabase.current;

      if (!db) return;

      const { error } =
        await db
          .from(
            "live_results_config"
          )
          .update({
            enabled: false,
          })
          .eq(
            "id",
            currentConfig.id
          );

      if (error) {
        setMessage(
          error.message
        );
        return;
      }

      setLiveResultsConfig({
        ...currentConfig,
        enabled: false,
      });

      setLiveTeam(null);
      setLiveLaps([]);

      setMessage(
        "RC-Results tracking stopped."
      );
    };

  /*
   * Poll RC-Results and
   * store newly completed laps.
   */
  const pollLiveResults =
    useCallback(
      async () => {
        const currentConfig =
          liveResultsConfig;

        const currentSession =
          session;

        const currentRace =
          race;

        if (
          !currentConfig?.enabled ||
          !currentConfig.race_url ||
          !currentConfig.team_name ||
          !currentSession ||
          !currentRace
        ) {
          return;
        }

        try {
          const response =
            await fetch(
              `/api/rc-results?url=${encodeURIComponent(
                currentConfig.race_url
              )}&team=${encodeURIComponent(
                currentConfig.team_name
              )}`,
              {
                cache:
                  "no-store",
              }
            );

          const contentType =
            response.headers.get("content-type") ?? "";

          if (
            !contentType.includes(
              "application/json"
            )
          ) {
            const text =
              await response.text();

            console.error(
              "RC-Results polling returned non-JSON:",
              text
            );

            return;
          }

          const data =
            await response.json();

          if (
            !response.ok
          ) {
            return;
          }

          if (data.team) {
            setLiveTeam(
              data.team
            );
          }

          const incomingLaps:
            LiveLap[] =
            Array.isArray(
              data.lapData
            )
              ? data.lapData
              : [];

          setLiveLaps(
            incomingLaps
          );

          if (
            incomingLaps.length === 0
          ) {
            return;
          }

          const existingLapNumbers =
            new Set(
              raceLaps.map(
                (lap) =>
                  lap.lap_number
              )
            );

          const newLaps =
            incomingLaps.filter(
              (lap) =>
                !existingLapNumbers.has(
                  lap.lapNumber
                )
            );

          if (
            newLaps.length === 0
          ) {
            return;
          }

          /*
           * Attribute new laps
           * to the driver who is
           * currently driving.
           */
          if (
            !currentRace.current_driver_id
          ) {
            return;
          }

          const rows =
            newLaps.map(
              (lap) => ({
                session_id:
                  currentSession.id,

                stint_id:
                  currentRace.active_stint_id,

                driver_id:
                  currentRace.current_driver_id,

                lap_number:
                  lap.lapNumber,

                lap_time_seconds:
                  lap.lapTime,

                completed_at:
                  new Date().toISOString(),
              })
            );

          const {
            data: inserted,
            error,
          } = await supabase.current
            .from("race_laps")
            .upsert(rows, {
              onConflict:
                "session_id,lap_number",
              ignoreDuplicates:
                true,
            })
            .select();

          if (error) {
            return;
          }

          if (
            inserted &&
            inserted.length > 0
          ) {
            setRaceLaps(
              (
                previous
              ) => {
                const existing =
                  new Set(
                    previous.map(
                      (lap) =>
                        lap.lap_number
                    )
                  );

                const additions =
                  inserted.filter(
                    (
                      lap: RaceLap
                    ) =>
                      !existing.has(
                        lap.lap_number
                      )
                  );

                return [
                  ...previous,
                  ...additions,
                ].sort(
                  (a, b) =>
                    a.lap_number -
                    b.lap_number
                );
              }
            );
          }
        } catch {
          /*
           * Keep the dashboard
           * running if RC-Results
           * temporarily fails.
           */
        }
      },
      [
        liveResultsConfig,
        session,
        race,
        raceLaps,
      ]
    );

  /*
   * Poll every five seconds.
   */
  useEffect(() => {
    if (
      !liveResultsConfig?.enabled ||
      !liveResultsConfig.team_name
    ) {
      return;
    }

    void pollLiveResults();

    const interval =
      window.setInterval(
        () => {
          void pollLiveResults();
        },
        5000
      );

    return () => {
      window.clearInterval(
        interval
      );
    };
  }, [
    liveResultsConfig,
    pollLiveResults,
  ]);

  /*
   * Leave session.
   */
  const leaveSession = () => {
    setSession(null);
    setRace(null);
    setDrivers([]);
    setQueue([]);
    setLiveResultsConfig(null);
    setLiveTeams([]);
    setLiveTeam(null);
    setLiveLaps([]);
    setRaceLaps([]);
    setMessage("");
    setShowShare(false);

    if (
      typeof window !==
      "undefined"
    ) {
      window.history.replaceState(
        null,
        "",
        "/"
      );
    }
  };

  /*
   * Create share URL.
   */
  const getShareLink = () => {
    if (!session) return "";

    if (
      typeof window ===
      "undefined"
    ) {
      return "";
    }

    return `${window.location.origin}/?session=${encodeURIComponent(
      session.session_code
    )}`;
  };

  /*
   * Copy share link.
   */
  const copyShareLink =
    async () => {
      const shareLink =
        getShareLink();

      if (!shareLink) {
        return;
      }

      try {
        await navigator.clipboard.writeText(
          shareLink
        );

        setMessage(
          "Share link copied."
        );
      } catch {
        setMessage(
          "Could not copy the share link."
        );
      }
    };

  /*
   * Race elapsed time.
   */
  const elapsed = useMemo(() => {
    if (!race?.started_at) {
      return 0;
    }

    const startedAt =
      new Date(
        race.started_at
      ).getTime();

    if (
      Number.isNaN(
        startedAt
      )
    ) {
      return 0;
    }

    let total =
      Math.floor(
        (now - startedAt) /
          1000
      ) -
      race.accumulated_pause_seconds;

    if (
      race.status ===
        "paused" &&
      race.paused_at
    ) {
      const pausedAt =
        new Date(
          race.paused_at
        ).getTime();

      if (
        !Number.isNaN(
          pausedAt
        )
      ) {
        total -= Math.floor(
          (now - pausedAt) /
            1000
        );
      }
    }

    return Math.max(
      0,
      total
    );
  }, [race, now]);

  /*
   * Current stint duration.
   */
  const stint = useMemo(() => {
    if (
      !race?.current_stint_started_at
    ) {
      return 0;
    }

    let total =
      secondsSince(
        race.current_stint_started_at,
        now
      );

    if (
      race.status ===
        "paused" &&
      race.paused_at
    ) {
      total -=
        secondsSince(
          race.paused_at,
          now
        );
    }

    return Math.max(
      0,
      total
    );
  }, [race, now]);

  const currentDriver =
    drivers.find(
      (driver) =>
        driver.id ===
        race?.current_driver_id
    ) ?? null;

  /*
   * Activity rotation.
   */
  const getActivityForDriver =
    (
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
            driver.id ===
            driverId
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
   * Driver statistics.
   */
  const getDriverStats =
    (
      driverId: string
    ) => {
      const laps =
        raceLaps.filter(
          (lap) =>
            lap.driver_id ===
            driverId
        );

      if (
        laps.length === 0
      ) {
        return {
          laps: 0,
          best: null,
          average: null,
        };
      }

      const lapTimes =
        laps.map(
          (lap) =>
            Number(
              lap.lap_time_seconds
            )
        );

      return {
        laps:
          laps.length,

        best:
          Math.min(
            ...lapTimes
          ),

        average:
          lapTimes.reduce(
            (
              total,
              value
            ) =>
              total +
              value,
            0
          ) /
          lapTimes.length,
      };
    };

  /*
   * Current driver's
   * current stint laps.
   */
  const currentStintLaps =
    raceLaps.filter(
      (lap) =>
        lap.driver_id ===
        race?.current_driver_id &&
        lap.stint_id ===
          race?.active_stint_id
    );

  /*
   * Join/create screen.
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
              Create or join a
              live race session.
            </p>
          </div>

          <button
            className="icon"
            onClick={() =>
              setDark(
                (value) =>
                  !value
              )
            }
            aria-label="Toggle theme"
          >
            {dark
              ? "☀"
              : "◐"}
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
              onChange={(
                event
              ) =>
                setJoinCode(
                  event.target
                    .value
                )
              }
              onKeyDown={(
                event
              ) => {
                if (
                  event.key ===
                    "Enter" &&
                  !loading &&
                  joinCode.trim()
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
   * Safe aliases.
   * TypeScript now knows both
   * objects are definitely present.
   */
  const activeRace = race;
  const activeSession = session;

  const timeRemaining =
    Math.max(
      0,
      activeRace.duration_seconds -
        elapsed
    );

  const shareLink =
    getShareLink();

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
              {
                activeSession.session_code
              }
            </b>{" "}

            <button
              onClick={() =>
                setShowShare(
                  true
                )
              }
            >
              SHARE
            </button>{" "}

            <button
              onClick={
                leaveSession
              }
            >
              LEAVE
            </button>
          </p>
        </div>

        <button
          className="icon"
          onClick={() =>
            setDark(
              (value) =>
                !value
            )
          }
          aria-label="Toggle theme"
        >
          {dark
            ? "☀"
            : "◐"}
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
              timeRemaining
            )}
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

        {/* LIVE RC-RESULTS */}

        <article className="card">
          <div className="titleRow">
            <span>
              LIVE RC-RESULTS
            </span>

            {liveResultsConfig?.enabled && (
              <small>
                ● LIVE
              </small>
            )}
          </div>

          {!liveResultsConfig?.enabled && (
            <>
              <input
                className="rcUrlInput"
                value={rcResultsUrl}
                onChange={(
                  event
                ) =>
                  setRcResultsUrl(
                    event.target
                      .value
                  )
                }
                placeholder="PASTE RC-RESULTS LIVE RACE URL"
              />

              <button
                className="primary liveButton"
                disabled={
                  connectingLiveResults ||
                  !rcResultsUrl.trim()
                }
                onClick={() => {
                  void connectLiveResults();
                }}
              >
                {connectingLiveResults
                  ? "CONNECTING..."
                  : "FIND TEAMS"}
              </button>

              {liveTeams.length > 0 && (
                <div className="teamPicker">
                  <p>
                    SELECT YOUR TEAM
                  </p>

                  {liveTeams.map(
                    (team) => (
                      <button
                        key={
                          team.name
                        }
                        className={
                          selectedTeamName ===
                          team.name
                            ? "selectedTeam"
                            : ""
                        }
                        onClick={() =>
                          setSelectedTeamName(
                            team.name
                          )
                        }
                      >
                        {team.name}
                      </button>
                    )
                  )}

                  <button
                    className="primary"
                    disabled={
                      !selectedTeamName
                    }
                    onClick={() => {
                      void saveLiveResultsTeam();
                    }}
                  >
                    TRACK THIS TEAM
                  </button>
                </div>
              )}
            </>
          )}

          {liveResultsConfig?.enabled && (
            <div className="liveStats">
              <div className="titleRow">
                <h2>
                  {liveTeam?.name ??
                    liveResultsConfig.team_name}
                </h2>

                <button
                  className="danger"
                  onClick={() => {
                    void disconnectLiveResults();
                  }}
                >
                  STOP
                </button>
              </div>

              <div className="liveStatGrid">
                <div>
                  <span>
                    POSITION
                  </span>

                  <b>
                    {liveTeam?.position ??
                      "--"}
                  </b>
                </div>

                <div>
                  <span>
                    LAPS
                  </span>

                  <b>
                    {liveTeam?.laps ??
                      liveLaps.length}
                  </b>
                </div>

                <div>
                  <span>
                    LAST LAP
                  </span>

                  <b>
                    {fmtLap(
                      liveTeam?.lastLap
                    )}
                  </b>
                </div>

                <div>
                  <span>
                    BEST LAP
                  </span>

                  <b>
                    {fmtLap(
                      liveTeam?.bestLap
                    )}
                  </b>
                </div>

                <div>
                  <span>
                    AVERAGE
                  </span>

                  <b>
                    {fmtLap(
                      liveTeam?.averageLap
                    )}
                  </b>
                </div>
              </div>

              <p className="muted">
                Tracking laps every
                5 seconds.
              </p>
            </div>
          )}
        </article>

        {/* ACTIVITY TRACKER */}

        <article className="card activity">
          <div className="titleRow">
            <span>
              ACTIVITY TRACKER
            </span>

            <small>
              DRIVE → REST → PIT →
              MARSHAL
            </small>
          </div>

          <div className="activityList">
            {drivers.length === 0 && (
              <p className="muted">
                Add drivers to see
                the activity rotation.
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
                    key={
                      driver.id
                    }
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
                        {
                          activity.name
                        }
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
              {queue.length} queued
            </small>
          </div>

          {queue.length === 0 ? (
            <p className="muted">
              Add drivers below.
              Drivers can appear
              multiple times.
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
                  key={
                    driver.id
                  }
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

        {/* DRIVERS */}

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
              onChange={(
                event
              ) =>
                setNewDriver(
                  event.target
                    .value
                )
              }
              onKeyDown={(
                event
              ) => {
                if (
                  event.key ===
                  "Enter"
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
            (driver) => {
              const stats =
                getDriverStats(
                  driver.id
                );

              return (
                <div
                  className="driver"
                  key={
                    driver.id
                  }
                >
                  <div className="driverInfo">
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

                    <small>
                      {stats.laps} laps
                      {" · "}
                      Best{" "}
                      {fmtLap(
                        stats.best
                      )}
                      {" · "}
                      Avg{" "}
                      {fmtLap(
                        stats.average
                      )}
                    </small>
                  </div>

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
              );
            }
          )}
        </article>

        {/* CURRENT STINT LAPS */}

        <article className="card">
          <div className="titleRow">
            <span>
              CURRENT STINT LAPS
            </span>

            <small>
              {
                currentDriver?.name ??
                "No driver"
              }
            </small>
          </div>

          {currentStintLaps.length ===
          0 ? (
            <p className="muted">
              No laps recorded for
              this stint yet.
            </p>
          ) : (
            <div className="lapList">
              {currentStintLaps
                .slice()
                .reverse()
                .slice(0, 20)
                .map((lap) => (
                  <div
                    className="lapRow"
                    key={
                      lap.id
                    }
                  >
                    <span>
                      LAP{" "}
                      {
                        lap.lap_number
                      }
                    </span>

                    <b>
                      {fmtLap(
                        Number(
                          lap.lap_time_seconds
                        )
                      )}
                    </b>
                  </div>
                ))}
            </div>
          )}
        </article>

        {/* SESSION STATUS */}

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
              {
                activeSession.session_code
              }
            </b>
          </p>

          <p>
            RC-Results laps
            stored:{" "}
            <b>
              {raceLaps.length}
            </b>
          </p>

          <button
            onClick={() =>
              setShowShare(
                true
              )
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
            setShowShare(
              false
            )
          }
        >
          <div
            className="shareModal"
            onClick={(
              event
            ) =>
              event.stopPropagation()
            }
          >
            <div className="shareHeader">
              <div>
                <span>
                  SHARE SESSION
                </span>

                <h2>
                  {
                    activeSession.session_code
                  }
                </h2>
              </div>

              <button
                className="closeButton"
                onClick={() =>
                  setShowShare(
                    false
                  )
                }
                aria-label="Close share window"
              >
                ×
              </button>
            </div>

            <p className="muted">
              Copy the link or scan
              the QR code on another
              phone or tablet to join
              this live race session.
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
              <p>
                SCAN TO JOIN
              </p>

              <div className="qrCode">
                <QRCodeSVG
                  value={
                    shareLink
                  }
                  size={220}
                  level="M"
                  includeMargin={
                    true
                  }
                />
              </div>
            </div>

            <button
              className="closeShareButton"
              onClick={() =>
                setShowShare(
                  false
                )
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
