"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { QRCodeSVG } from "qrcode.react";
import * as XLSX from "xlsx";
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

type DriverStint = {
  id: string;
  session_id: string;
  driver_id: string;
  started_at: string;
  ended_at: string | null;
  start_lap: number;
  end_lap: number | null;
};

type RaceEvent = {
  id: string;
  session_id: string;
  event_type: "battery_swap" | "driver_swap" | "full_swap" | string;
  outgoing_driver_id: string | null;
  incoming_driver_id: string | null;
  created_at: string;
  notes?: string | null;
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

  const [stints, setStints] =
    useState<DriverStint[]>([]);

  const [raceEvents, setRaceEvents] =
    useState<RaceEvent[]>([]);

  const [historyDriverFilter, setHistoryDriverFilter] =
    useState("all");

  const [historyDateFilter, setHistoryDateFilter] =
    useState("");

  const [activityNote, setActivityNote] =
    useState("");

  const [activeTab, setActiveTab] =
    useState<"race" | "team" | "analysis" | "strategy">("race");

  const [stintTargetMinutes, setStintTargetMinutes] =
    useState(20);
  const [stintAlertMinutes, setStintAlertMinutes] =
    useState(3);
  const [audioAlerts, setAudioAlerts] =
    useState(true);
  const [showBatteryChange, setShowBatteryChange] =
    useState(true);
  const [showDriverChange, setShowDriverChange] =
    useState(true);
  const [showFullChange, setShowFullChange] =
    useState(true);
  const [autoStartFromLive, setAutoStartFromLive] =
    useState(false);
  const [alertedStint, setAlertedStint] =
    useState<string | null>(null);

  const [strategyRaceMinutes, setStrategyRaceMinutes] = useState(240);
  const [strategyLapTime, setStrategyLapTime] = useState(15);
  const [strategyBatteryMinutes, setStrategyBatteryMinutes] = useState(25);
  const [strategySwapSeconds, setStrategySwapSeconds] = useState(30);

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
   *
   * Independent from queue, activity tracking and live timing.
   */
  const addDriver =
    async () => {
      const currentSession = session;
      const currentRace = race;
      const driverName = newDriver.trim();
      const db = supabase.current;

      if (!currentSession) {
        setMessage(
          "No active session. Please create or join a session first."
        );
        return;
      }

      if (!driverName) {
        setMessage(
          "Please enter a driver name."
        );
        return;
      }

      if (!db) {
        setMessage(
          "Supabase is not configured."
        );
        return;
      }

      setMessage("");

      const {
        data,
        error,
      } = await db
        .from("drivers")
        .insert({
          session_id:
            currentSession.id,
          name:
            driverName,
        })
        .select()
        .single();

      if (error) {
        console.error(
          "Could not add driver:",
          error
        );
        setMessage(
          `Could not save driver: ${error.message}`
        );
        return;
      }

      if (!data) {
        setMessage(
          "Driver was not returned after saving."
        );
        return;
      }

      // Update immediately; do not depend on Supabase Realtime.
      setDrivers(
        (currentDrivers) =>
          currentDrivers.some(
            (driver) =>
              driver.id === data.id
          )
            ? currentDrivers
            : [
                ...currentDrivers,
                data as Driver,
              ]
      );

      setNewDriver("");

      /*
       * Only assign the first driver to the race when the race
       * row is available. Saving the driver does not depend on it.
       */
      if (
        currentRace &&
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
            driver_id:
              data.id,
            started_at:
              nowIso,
            start_lap:
              raceLaps.length,
          })
          .select()
          .single();

        if (stintError) {
          console.error(
            "Could not create first stint:",
            stintError
          );
          setMessage(
            `Driver saved, but the first stint could not be created: ${stintError.message}`
          );
          return;
        }

        const {
          error: raceError,
        } = await db
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

        if (raceError) {
          console.error(
            "Could not set current driver:",
            raceError
          );
          setMessage(
            `Driver saved, but could not set them as the current driver: ${raceError.message}`
          );
          return;
        }

        setRace({
          ...currentRace,
          current_driver_id:
            data.id,
          current_stint_started_at:
            nowIso,
          active_stint_id:
            newStint?.id ??
            null,
        });
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
        return;
      }

    };

  /*
   * Add one driver occurrence to the queue.
   * Duplicates are intentionally allowed.
   */
  const addQueue =
    async (
      driverId: string
    ) => {
      const currentSession = session;
      const db = supabase.current;

      if (!currentSession) {
        setMessage(
          "No active session. Please create or join a session first."
        );
        return;
      }

      if (!db) {
        setMessage("Supabase is not configured.");
        return;
      }

      const nextPosition =
        queue.reduce(
          (highest, item) =>
            Math.max(
              highest,
              Number(item.position) || 0
            ),
          0
        ) + 1;

      const {
        data,
        error,
      } = await db
        .from("driver_queue")
        .insert({
          session_id:
            currentSession.id,
          driver_id:
            driverId,
          position:
            nextPosition,
        })
        .select()
        .single();

      if (error || !data) {
        console.error(
          "Could not add driver to queue:",
          error
        );
        setMessage(
          error?.message ??
            "Could not add driver to queue."
        );
        return;
      }

      setMessage("");

      // Update immediately without depending on Realtime.
      setQueue(
        (currentQueue) =>
          [
            ...currentQueue,
            data as QueueItem,
          ].sort(
            (a, b) =>
              Number(a.position) -
              Number(b.position)
          )
      );
    };

  /*
   * Remove exactly one queue occurrence.
   * Queue item id is used so duplicate drivers remain independent.
   */
  const removeQueue =
    async (
      queueItemId: string
    ) => {
      const db = supabase.current;

      if (!db) {
        setMessage("Supabase is not configured.");
        return;
      }

      const { error } =
        await db
          .from("driver_queue")
          .delete()
          .eq("id", queueItemId);

      if (error) {
        console.error(
          "Could not remove queue item:",
          error
        );
        setMessage(error.message);
        return;
      }

      setMessage("");

      setQueue(
        (currentQueue) =>
          currentQueue.filter(
            (item) =>
              item.id !== queueItemId
          )
      );
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
        return;
      }

      /*
       * Update local state immediately so Start/Pause/Reset take
       * effect without waiting for a Supabase reload or Realtime event.
       */
      setRace({
        ...currentRace,
        ...updates,
      });

      setMessage("");
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
   * Battery swap, driver swap or both.
   *
   * This function updates Supabase and the local UI state separately.
   * It intentionally does not change the timer, live tracking, drivers
   * list or queue add/remove functions.
   */
  const swap =
    async (
      type:
        | "battery_swap"
        | "driver_swap"
        | "full_swap"
    ) => {
      const currentSession = session;
      const currentRace = race;
      const db = supabase.current;

      if (!currentSession || !currentRace) {
        setMessage(
          "Race data is not ready yet. Please wait a moment and try again."
        );
        return;
      }

      if (!db) {
        setMessage("Supabase is not configured.");
        return;
      }

      setMessage("");

      /*
       * Battery-only change: reset the stint start time but keep
       * the same driver, queue and activity rotation.
       */
      if (type === "battery_swap") {
        const nowIso = new Date().toISOString();

        const { error } = await db
          .from("races")
          .update({
            current_stint_started_at: nowIso,
          })
          .eq("id", currentRace.id);

        if (error) {
          setMessage(error.message);
          return;
        }

        setRace({
          ...currentRace,
          current_stint_started_at: nowIso,
        });

        await db
          .from("race_events")
          .insert({
            session_id: currentSession.id,
            event_type: "battery_swap",
            outgoing_driver_id:
              currentRace.current_driver_id,
            incoming_driver_id:
              currentRace.current_driver_id,
            notes: activityNote.trim() || null,
          });

        setActivityNote("");
        void refreshHistory();

        return;
      }

      /*
       * Driver/full change: consume exactly the first queue item.
       * Do NOT automatically put the outgoing driver back in the queue;
       * this makes the queue visibly move down and leaves the next
       * rotation entirely under the user's control.
       */
      const firstQueueItem = queue[0];

      if (!firstQueueItem) {
        setMessage(
          "There is no driver in the queue."
        );
        return;
      }

      const incomingDriverId =
        firstQueueItem.driver_id;

      const nowIso =
        new Date().toISOString();

      /*
       * Close the outgoing stint first. This is left intact so driver
       * lap/stint statistics continue to work.
       */
      await closeCurrentStint();

      const { error: deleteError } =
        await db
          .from("driver_queue")
          .delete()
          .eq("id", firstQueueItem.id);

      if (deleteError) {
        setMessage(deleteError.message);
        return;
      }

      /*
       * Save the incoming stint.
       */
      const {
        data: newStint,
        error: stintError,
      } = await db
        .from("driver_stints")
        .insert({
          session_id: currentSession.id,
          driver_id: incomingDriverId,
          started_at: nowIso,
          start_lap: raceLaps.length,
        })
        .select()
        .single();

      if (stintError) {
        setMessage(stintError.message);
        return;
      }

      const nextActivityRotation =
        (currentRace.activity_rotation ?? 0) + 1;

      const { error: raceUpdateError } =
        await db
          .from("races")
          .update({
            current_driver_id: incomingDriverId,
            current_stint_started_at: nowIso,
            activity_rotation: nextActivityRotation,
            active_stint_id: newStint?.id ?? null,
          })
          .eq("id", currentRace.id);

      if (raceUpdateError) {
        setMessage(raceUpdateError.message);
        return;
      }

      /*
       * Save the event after the successful state change.
       */
      const { error: eventError } =
        await db
          .from("race_events")
          .insert({
            session_id: currentSession.id,
            event_type: type,
            outgoing_driver_id:
              currentRace.current_driver_id,
            incoming_driver_id:
              incomingDriverId,
            notes: activityNote.trim() || null,
          });

      if (eventError) {
        console.error(
          "Could not save race event:",
          eventError
        );
      }

      /*
       * Update the queue and race immediately. This is what makes
       * Current Driver and Activity Tracker change without waiting
       * for Supabase Realtime.
       */
      setQueue(
        (currentQueue) =>
          currentQueue.filter(
            (item) =>
              item.id !== firstQueueItem.id
          )
      );

      setRace({
        ...currentRace,
        current_driver_id: incomingDriverId,
        current_stint_started_at: nowIso,
        activity_rotation: nextActivityRotation,
        active_stint_id: newStint?.id ?? null,
      });

      setActivityNote("");
      void refreshHistory();
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
   * Poll RC-Results and store completed laps.
   *
   * This version does not depend on a Supabase unique
   * constraint for upsert(). It filters out laps already
   * known locally, then inserts only genuinely new laps.
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

        const db =
          supabase.current;

        if (
          !currentConfig?.enabled ||
          !currentConfig.race_url ||
          !currentConfig.team_name ||
          !currentSession ||
          !currentRace ||
          !db
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
                cache: "no-store",
              }
            );

          const contentType =
            response.headers.get(
              "content-type"
            ) ?? "";

          if (
            !contentType.includes(
              "application/json"
            )
          ) {
            const responseText =
              await response.text();

            console.error(
              "RC-Results polling returned non-JSON:",
              responseText
            );

            setMessage(
              "RC-Results returned an invalid response while checking laps."
            );

            return;
          }

          const data =
            await response.json();

          if (!response.ok) {
            console.error(
              "RC-Results polling failed:",
              data
            );

            setMessage(
              data.error ??
                "Could not update RC-Results laps."
            );

            return;
          }

          if (data.team) {
            setLiveTeam(
              data.team as LiveTeam
            );
          }

          const incomingLaps: LiveLap[] =
            Array.isArray(
              data.lapData
            )
              ? data.lapData
                  .map(
                    (
                      lap: LiveLap
                    ) => ({
                      lapNumber:
                        Number(
                          lap.lapNumber
                        ),
                      lapTime:
                        Number(
                          lap.lapTime
                        ),
                    })
                  )
                  .filter(
                    (lap: LiveLap) =>
                      Number.isFinite(
                        lap.lapNumber
                      ) &&
                      lap.lapNumber > 0 &&
                      Number.isFinite(
                        lap.lapTime
                      ) &&
                      lap.lapTime > 0
                  )
              : [];

          setLiveLaps(
            incomingLaps
          );
          if (
            autoStartFromLive &&
            currentRace.status === "idle" &&
            incomingLaps.length > 0
          ) {
            await db.from("races").update({
              status: "running",
              started_at: new Date().toISOString(),
              paused_at: null,
              accumulated_pause_seconds: 0,
            }).eq("id", currentRace.id);
            setRace({
              ...currentRace,
              status: "running",
              started_at: new Date().toISOString(),
              paused_at: null,
              accumulated_pause_seconds: 0,
            });
          }

          /*
           * If RC-Results is providing only the summary
           * and no individual lap data, show the live
           * total but do not pretend that laps were saved.
           */
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
           * Always store new laps, even if no driver has
           * been selected yet. Driver/stint IDs can be null
           * for those laps, allowing the overall lap count
           * to continue working.
           */
          const rows =
            newLaps.map(
              (lap) => ({
                session_id:
                  currentSession.id,

                stint_id:
                  currentRace.active_stint_id ??
                  null,

                driver_id:
                  currentRace.current_driver_id ??
                  null,

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
          } = await db
            .from("race_laps")
            .insert(rows)
            .select();

          if (error) {
            console.error(
              "Could not save RC-Results laps:",
              error
            );

            setMessage(
              `RC-Results laps found, but could not save them: ${error.message}`
            );

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

            setMessage(
              `${inserted.length} new RC-Results lap${
                inserted.length === 1
                  ? ""
                  : "s"
              } recorded.`
            );
          }
        } catch (error) {
          console.error(
            "RC-Results polling failed:",
            error
          );

          setMessage(
            error instanceof Error
              ? `RC-Results update failed: ${error.message}`
              : "RC-Results update failed."
          );
        }
      },
      [
        liveResultsConfig,
        session,
        race,
        raceLaps,
        autoStartFromLive,
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
   * Load completed stints and rotation events for history/reporting.
   */
  const refreshHistory =
    useCallback(async () => {
      const db = supabase.current;
      const currentSession = session;

      if (!db || !currentSession) return;

      const [
        { data: stintData },
        { data: eventData },
      ] = await Promise.all([
        db
          .from("driver_stints")
          .select("*")
          .eq("session_id", currentSession.id)
          .order("started_at", { ascending: false }),
        db
          .from("race_events")
          .select("*")
          .eq("session_id", currentSession.id)
          .order("created_at", { ascending: false }),
      ]);

      setStints(
        (stintData ?? []) as DriverStint[]
      );
      setRaceEvents(
        (eventData ?? []) as RaceEvent[]
      );
    }, [session]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

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
    setStints([]);
    setRaceEvents([]);
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
   * The resting driver is always the driver immediately after
   * the current driver in the activity rotation:
   * Drive → Rest → Pit → Marshal.
   */
  const nextDriver =
    (() => {
      if (
        !race?.current_driver_id ||
        drivers.length < 2
      ) {
        return null;
      }

      const currentIndex =
        drivers.findIndex(
          (driver) =>
            driver.id ===
            race.current_driver_id
        );

      if (currentIndex === -1) {
        return null;
      }

      return (
        drivers[
          (currentIndex + 1) %
            drivers.length
        ] ?? null
      );
    })();

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

  const completedStints = useMemo(
    () =>
      stints.filter(
        (stintItem) => stintItem.ended_at
      ),
    [stints]
  );

  const filteredStints = useMemo(() => {
    return completedStints.filter(
      (stintItem) => {
        const driverMatch =
          historyDriverFilter === "all" ||
          stintItem.driver_id === historyDriverFilter;

        const dateMatch =
          !historyDateFilter ||
          stintItem.started_at.slice(0, 10) ===
            historyDateFilter;

        return driverMatch && dateMatch;
      }
    );
  }, [
    completedStints,
    historyDriverFilter,
    historyDateFilter,
  ]);

  const driverLoad = useMemo(
    () =>
      drivers.map((driver) => {
        const totalSeconds =
          stints
            .filter(
              (stintItem) =>
                stintItem.driver_id === driver.id
            )
            .reduce(
              (total, stintItem) => {
                const end =
                  stintItem.ended_at
                    ? new Date(
                        stintItem.ended_at
                      ).getTime()
                    : Date.now();

                return (
                  total +
                  Math.max(
                    0,
                    Math.floor(
                      (end -
                        new Date(
                          stintItem.started_at
                        ).getTime()) /
                        1000
                    )
                  )
                );
              },
              0
            );

        return {
          driver,
          totalSeconds,
        };
      }),
    [drivers, stints]
  );

  const stintRemaining = Math.max(0, stintTargetMinutes * 60 - stint);
  const stintWarning = race?.status === "running" && stintRemaining <= stintAlertMinutes * 60;

  useEffect(() => {
    if (!stintWarning || !race?.active_stint_id || alertedStint === race.active_stint_id) return;
    setAlertedStint(race.active_stint_id);
    if (audioAlerts && typeof window !== "undefined") {
      try {
        const AudioContextClass = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 880;
          gain.gain.value = 0.08;
          osc.connect(gain); gain.connect(ctx.destination); osc.start();
          window.setTimeout(() => { osc.stop(); void ctx.close(); }, 450);
        }
      } catch { /* visual alert still works */ }
    }
  }, [stintWarning, race?.active_stint_id, alertedStint, audioAlerts]);

  useEffect(() => {
    if (!stintWarning) setAlertedStint(null);
  }, [stintWarning]);

  const strategyRows = useMemo(() => {
    const raceSeconds = strategyRaceMinutes * 60;
    const candidates: { minutes: number; stops: number; laps: number; lostLaps: number; effectiveSeconds: number }[] = [];
    for (let minutes = 20; minutes <= Math.max(20, Math.floor(strategyBatteryMinutes)); minutes += 1) {
      const stintSeconds = minutes * 60;
      const stintsNeeded = Math.ceil(raceSeconds / stintSeconds);
      const stops = Math.max(0, stintsNeeded - 1);
      const effectiveSeconds = Math.max(0, raceSeconds - stops * strategySwapSeconds);
      const laps = strategyLapTime > 0 ? effectiveSeconds / strategyLapTime : 0;
      candidates.push({ minutes, stops, laps, lostLaps: strategyLapTime > 0 ? stops * strategySwapSeconds / strategyLapTime : 0, effectiveSeconds });
    }
    return candidates.sort((a,b) => b.laps - a.laps);
  }, [strategyRaceMinutes, strategyLapTime, strategyBatteryMinutes, strategySwapSeconds]);

  const optimalStrategy = strategyRows[0] ?? null;

  const liveRecommendation = useMemo(() => {
    const laps = currentStintLaps.map(l => Number(l.lap_time_seconds)).filter(Number.isFinite);
    const baseline = laps.length >= 3 ? laps.slice(0, Math.min(5, laps.length)).reduce((a,b)=>a+b,0) / Math.min(5,laps.length) : null;
    const recent = laps.length >= 3 ? laps.slice(-Math.min(5,laps.length)).reduce((a,b)=>a+b,0) / Math.min(5,laps.length) : null;
    const delta = baseline !== null && recent !== null ? recent - baseline : null;
    const next = queue[0] ? drivers.find(d => d.id === queue[0].driver_id)?.name : null;
    const target = Math.min(stintTargetMinutes, strategyBatteryMinutes) * 60;
    const remaining = Math.max(0, target - stint);
    const lostLaps = strategyLapTime > 0 ? strategySwapSeconds / strategyLapTime : 0;
    return { baseline, recent, delta, next, remaining, lostLaps };
  }, [currentStintLaps, queue, drivers, stint, stintTargetMinutes, strategyBatteryMinutes, strategyLapTime, strategySwapSeconds]);

  const recentDriverSeries = useMemo(() => drivers.map(driver => ({
    driver,
    laps: raceLaps.filter(l => l.driver_id === driver.id).slice(-30)
  })), [drivers, raceLaps]);

  /*
   * Join/create screen.
   */
  if (!session || !race) {
    return (
      <main data-tab={activeTab}>
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



  const exportResults = () => {
    const rows = completedStints.map(
      (stintItem) => {
        const driver =
          drivers.find(
            (item) =>
              item.id === stintItem.driver_id
          );

        const stintLaps =
          raceLaps.filter(
            (lap) =>
              lap.stint_id === stintItem.id
          );

        const relatedNotes =
          raceEvents
            .filter(
              (event) =>
                event.created_at >=
                  stintItem.started_at &&
                (!stintItem.ended_at ||
                  event.created_at <=
                    stintItem.ended_at)
            )
            .map(
              (event) =>
                event.notes
            )
            .filter(Boolean)
            .join(" | ");

        const seconds =
          stintItem.ended_at
            ? Math.max(
                0,
                Math.floor(
                  (new Date(
                    stintItem.ended_at
                  ).getTime() -
                    new Date(
                      stintItem.started_at
                    ).getTime()) /
                    1000
                )
              )
            : 0;

        return {
          Driver: driver?.name ?? "Unknown",
          "Stint started": new Date(
            stintItem.started_at
          ).toLocaleString(),
          "Stint ended": stintItem.ended_at
            ? new Date(
                stintItem.ended_at
              ).toLocaleString()
            : "",
          "Total stint time": fmt(seconds),
          "Lap count": stintLaps.length,
          "Lap times": stintLaps
            .map(
              (lap) =>
                fmtLap(
                  lap.lap_time_seconds
                )
            )
            .join(", "),
          Notes: relatedNotes,
        };
      }
    );

    const loadRows = driverLoad.map(
      (item) => ({
        Driver: item.driver.name,
        "Total track time":
          fmt(item.totalSeconds),
      })
    );

    const rotationRows = raceEvents.map(
      (event) => ({
        Timestamp: new Date(
          event.created_at
        ).toLocaleString(),
        Event: event.event_type
          .replaceAll("_", " "),
        Outgoing:
          drivers.find(
            (driver) =>
              driver.id ===
              event.outgoing_driver_id
          )?.name ?? "",
        Incoming:
          drivers.find(
            (driver) =>
              driver.id ===
              event.incoming_driver_id
          )?.name ?? "",
        Notes: event.notes ?? "",
      })
    );

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows),
      "Stints"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(loadRows),
      "Driver Summary"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rotationRows),
      "Rotation History"
    );

    XLSX.writeFile(
      workbook,
      `rc-endurance-${session?.session_code ?? "results"}.xlsx`
    );
  };

  const shareLink =
    getShareLink();

  return (
    <main data-tab={activeTab}>
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

      <nav className="appTabs" aria-label="Dashboard sections">
        <button className={`appTab raceTab ${activeTab === "race" ? "active" : ""}`} onClick={() => setActiveTab("race")}>RACE</button>
        <button className={`appTab teamTab ${activeTab === "team" ? "active" : ""}`} onClick={() => setActiveTab("team")}>TEAM</button>
        <button className={`appTab analysisTab ${activeTab === "analysis" ? "active" : ""}`} onClick={() => setActiveTab("analysis")}>ANALYSIS</button>
        <button className={`appTab strategyTab ${activeTab === "strategy" ? "active" : ""}`} onClick={() => setActiveTab("strategy")}>STRATEGY</button>
      </nav>

<div className="tabPanel racePanel" hidden={activeTab !== "race"}>
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
            className="startButton"
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
            className="pauseButton"
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
            className="resetButton"
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

          <div className="currentDriverHeading">
            <h2>
              {currentDriver?.name ??
                "Add a driver"}
            </h2>

            <div className="nextDriver">
              <span>NEXT DRIVER</span>
              <strong>
                {nextDriver?.name ??
                  "—"}
              </strong>
            </div>
          </div>

          <b>
            STINT {fmt(stint)}
          </b>
          {stintWarning && <div className="stintWarning">⚠ STINT ALERT — {fmt(stintRemaining)} remaining. Prepare for the change.</div>}

          <div className="activityNote">
            <input
              value={activityNote}
              onChange={(event) =>
                setActivityNote(
                  event.target.value
                )
              }
              placeholder="Optional change note"
            />
          </div>

          <div className="swap">
            {showBatteryChange && <button
              className="changeButton"
              onClick={() => {
                void swap(
                  "battery_swap"
                );
              }}
            >
              🔋 BATTERY SWAP
            </button>}

            {showDriverChange && <button
              className="changeButton"
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
            </button>}

            {showFullChange && <button
              className="full changeButton"
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
            </button>}
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

              <div className="liveColumnHelp"><span>POSITION</span><span>LAPS COMPLETED</span><span>LAST LAP</span><span>BEST LAP</span><span>AVERAGE LAP</span></div>
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

        <article className="card activity raceOnly">
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

        <article className="card teamOnly">
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

        <article className="card teamOnly">
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

        <article className="card raceOnly">
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

        <article className="card history raceOnly">
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


</div>
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


      <section className="card analysisOnly historySection">
        <div className="titleRow"><span>DRIVER PACE COMPARISON</span><small>Recent 30 laps each</small></div>
        <div className="driverCharts">
          {recentDriverSeries.map(({driver,laps}) => laps.length > 1 && (
            <div className="driverChart" key={driver.id}>
              <strong>{driver.name}</strong>
              <svg viewBox="0 0 600 180" role="img" aria-label={`${driver.name} recent lap times`}>
                {(() => { const values=laps.map(l=>Number(l.lap_time_seconds)); const min=Math.min(...values); const max=Math.max(...values); const range=Math.max(.001,max-min); const pts=values.map((v,i)=>`${20+i/(values.length-1)*560},${15+(max-v)/range*140}`).join(" "); return <polyline fill="none" stroke="currentColor" strokeWidth="3" points={pts}/>; })()}
              </svg>
              <small>{laps.length} laps · Best {fmtLap(Math.min(...laps.map(l=>Number(l.lap_time_seconds))))}</small>
            </div>
          ))}
          {recentDriverSeries.every(x=>x.laps.length<2) && <p className="muted">Driver pace charts will appear once lap data has been assigned to drivers.</p>}
        </div>
      </section>

      <section className="card strategyOnly historySection">
        <div className="titleRow"><span>LIVE STRATEGY RECOMMENDATION</span><small>{liveResultsConfig?.enabled ? "LIVE DATA" : "WAITING FOR LIVE DATA"}</small></div>
        <div className="recommendation">
          <strong>RECOMMENDATION</strong>
          <h2>{liveRecommendation.remaining > 0 ? `Keep ${currentDriver?.name ?? "current driver"} out for another ${fmt(liveRecommendation.remaining)}.` : "Prepare to change now."}</h2>
          <p>{liveRecommendation.delta === null ? "Collecting enough current-stint laps to establish a pace baseline." : `Battery performance is ${Math.abs(liveRecommendation.delta).toFixed(3)}s ${liveRecommendation.delta <= 0 ? "faster than or within" : "slower than"} baseline.`}</p>
          <p>Changing now would cost approximately {liveRecommendation.lostLaps.toFixed(1)} laps.</p>
          <p>Next: {liveRecommendation.next ?? "add a driver to the queue"} + battery/driver change when the stint reaches its target.</p>
        </div>
      </section>

      <section className="card strategyOnly historySection">
        <div className="titleRow"><span>OPTIMAL STRATEGY SIMULATOR</span><small>Comparison starts at 20 minutes</small></div>
        <div className="strategyInputs">
          <label>Race duration (min)<input type="number" min="1" value={strategyRaceMinutes} onChange={e=>setStrategyRaceMinutes(Math.max(1,Number(e.target.value)||1))}/></label>
          <label>Average lap (s)<input type="number" min="0.1" step="0.001" value={strategyLapTime} onChange={e=>setStrategyLapTime(Math.max(.1,Number(e.target.value)||.1))}/></label>
          <label>Battery endurance (min)<input type="number" min="20" value={strategyBatteryMinutes} onChange={e=>setStrategyBatteryMinutes(Math.max(20,Number(e.target.value)||20))}/></label>
          <label>Swap time (s)<input type="number" min="0" value={strategySwapSeconds} onChange={e=>setStrategySwapSeconds(Math.max(0,Number(e.target.value)||0))}/></label>
        </div>
        {optimalStrategy && <div className="optimalCard"><strong>OPTIMAL: {optimalStrategy.minutes} MINUTES</strong><b>{optimalStrategy.stops} changes · projected {optimalStrategy.laps.toFixed(1)} laps</b></div>}
        <div className="historyTableWrap"><table className="historyTable"><thead><tr><th>Stint length</th><th>Changes</th><th>Swap loss</th><th>Projected laps</th></tr></thead><tbody>{strategyRows.map(row=><tr key={row.minutes}><td>{row.minutes} min</td><td>{row.stops}</td><td>{row.lostLaps.toFixed(2)} laps</td><td>{row.laps.toFixed(1)}</td></tr>)}</tbody></table></div>
      </section>

      <section className="card strategyOnly historySection">
        <div className="titleRow"><span>RACE SETTINGS</span></div>
        <div className="strategyInputs">
          <label>Stint target (min)<input type="number" min="1" value={stintTargetMinutes} onChange={e=>setStintTargetMinutes(Math.max(1,Number(e.target.value)||1))}/></label>
          <label>Alert trigger (min remaining)<input type="number" min="0" value={stintAlertMinutes} onChange={e=>setStintAlertMinutes(Math.max(0,Number(e.target.value)||0))}/></label>
          <label><input type="checkbox" checked={audioAlerts} onChange={e=>setAudioAlerts(e.target.checked)}/> Audio stint alert</label>
          <label><input type="checkbox" checked={autoStartFromLive} onChange={e=>setAutoStartFromLive(e.target.checked)}/> Start race when live laps arrive</label>
          <label><input type="checkbox" checked={showBatteryChange} onChange={e=>setShowBatteryChange(e.target.checked)}/> Show battery change</label>
          <label><input type="checkbox" checked={showDriverChange} onChange={e=>setShowDriverChange(e.target.checked)}/> Show driver change</label>
          <label><input type="checkbox" checked={showFullChange} onChange={e=>setShowFullChange(e.target.checked)}/> Show full change</label>
        </div>
      </section>

      {/* CURRENT STINT PACE */}
      <section className="card historySection analysisOnly">
        <div className="titleRow">
          <span>CURRENT STINT PACE</span>
          <small>{currentStintLaps.length} laps</small>
        </div>
        {currentStintLaps.length < 2 ? (
          <p className="muted">Complete at least two laps to see the pace chart.</p>
        ) : (
          <svg className="paceChart" viewBox="0 0 600 220" role="img" aria-label="Current stint lap time chart">
            {(() => {
              const values = currentStintLaps.map((lap) => lap.lap_time_seconds);
              const min = Math.min(...values);
              const max = Math.max(...values);
              const range = Math.max(0.001, max - min);
              const points = values.map((value, index) => {
                const x = values.length === 1 ? 300 : 20 + (index / (values.length - 1)) * 560;
                const y = 20 + ((max - value) / range) * 170;
                return `${x},${y}`;
              }).join(" ");
              return <polyline fill="none" stroke="var(--accent)" strokeWidth="3" points={points} />;
            })()}
          </svg>
        )}
      </section>

      {/* DRIVER LOAD SUMMARY */}
      <section className="card historySection teamOnly">
        <div className="titleRow">
          <span>DRIVER LOAD SUMMARY</span>
          <button onClick={exportResults}>EXPORT EXCEL</button>
        </div>
        <div className="loadGrid">
          {driverLoad.map((item) => (
            <div className="loadCard" key={item.driver.id}>
              <strong>{item.driver.name}</strong>
              <b>{fmt(item.totalSeconds)}</b>
            </div>
          ))}
        </div>
      </section>


      {/* DRIVER QUEUE */}
      <section className="card historySection teamOnly">
        <div className="titleRow">
          <span>DRIVER QUEUE</span>
          <small>{queue.length} queued</small>
        </div>

        {queue.length === 0 ? (
          <p className="muted">
            Add drivers below. Drivers can appear multiple times.
          </p>
        ) : (
          <ol>
            {queue.map((queueItem, index) => {
              const driver = drivers.find(
                (item) => item.id === queueItem.driver_id
              );

              return (
                <li key={queueItem.id}>
                  <b>{index + 1}</b>
                  <span>{driver?.name ?? "Unknown driver"}</span>
                  <button
                    onClick={() => {
                      void removeQueue(queueItem.id);
                    }}
                    aria-label="Remove from queue"
                  >
                    ×
                  </button>
                </li>
              );
            })}
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
      </section>

      {/* DRIVERS */}
      <section className="card historySection teamOnly">
        <div className="titleRow">
          <span>DRIVERS</span>
          <small>{drivers.length} drivers</small>
        </div>

        <div className="addDriver">
          <input
            value={newDriver}
            onChange={(event) => setNewDriver(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
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

        {drivers.length === 0 ? (
          <p className="muted">No drivers added yet.</p>
        ) : (
          drivers.map((driver) => {
            const stats = getDriverStats(driver.id);

            return (
              <div className="driver" key={driver.id}>
                <div className="driverInfo">
                  <button
                    className={
                      currentDriver?.id === driver.id
                        ? "selected"
                        : ""
                    }
                    onClick={() => {
                      void setCurrentDriver(driver.id);
                    }}
                  >
                    {driver.name}
                  </button>

                  <small>
                    {stats.laps} laps · Best {fmtLap(stats.best)} · Avg{" "}
                    {fmtLap(stats.average)}
                  </small>
                </div>

                <button
                  onClick={() => {
                    void editDriver(driver);
                  }}
                  aria-label={`Edit ${driver.name}`}
                >
                  ✎
                </button>
              </div>
            );
          })
        )}
      </section>

      {/* STINT HISTORY */}
      <section className="card historySection analysisOnly">
        <div className="titleRow">
          <span>STINT HISTORY</span>
          <small>{filteredStints.length} completed</small>
        </div>
        <div className="historyFilters">
          <select value={historyDriverFilter} onChange={(event) => setHistoryDriverFilter(event.target.value)}>
            <option value="all">All drivers</option>
            {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
          </select>
          <input type="date" value={historyDateFilter} onChange={(event) => setHistoryDateFilter(event.target.value)} />
          <button onClick={() => { setHistoryDriverFilter("all"); setHistoryDateFilter(""); }}>CLEAR</button>
        </div>
        <div className="historyTableWrap">
          <table className="historyTable">
            <thead><tr><th>Driver</th><th>Date</th><th>Time</th><th>Laps</th><th>Lap times</th></tr></thead>
            <tbody>
              {filteredStints.map((stintItem) => {
                const driver = drivers.find((item) => item.id === stintItem.driver_id);
                const stintLaps = raceLaps.filter((lap) => lap.stint_id === stintItem.id);
                const duration = stintItem.ended_at ? Math.max(0, Math.floor((new Date(stintItem.ended_at).getTime() - new Date(stintItem.started_at).getTime()) / 1000)) : 0;
                return <tr key={stintItem.id} title={`Laps: ${stintLaps.length} · Time driven: ${fmt(duration)}`}><td>{driver?.name ?? "Unknown"}</td><td>{new Date(stintItem.started_at).toLocaleDateString()}</td><td>{fmt(duration)}</td><td>{stintLaps.length}</td><td>{stintLaps.map((lap) => fmtLap(lap.lap_time_seconds)).join(", ") || "--"}</td></tr>;
              })}
              {filteredStints.length === 0 && <tr><td colSpan={5}>No completed stints match the selected filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* ROTATION HISTORY */}
      <section className="card historySection analysisOnly">
        <div className="titleRow">
          <span>ROTATION HISTORY</span>
          <small>{raceEvents.length} events</small>
        </div>
        <div className="historyTableWrap">
          <table className="historyTable">
            <thead><tr><th>Timestamp</th><th>Event</th><th>Outgoing</th><th>Incoming</th><th>Notes</th></tr></thead>
            <tbody>
              {raceEvents.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.created_at).toLocaleString()}</td>
                  <td>{event.event_type.replaceAll("_", " ")}</td>
                  <td>{drivers.find((driver) => driver.id === event.outgoing_driver_id)?.name ?? "--"}</td>
                  <td>{drivers.find((driver) => driver.id === event.incoming_driver_id)?.name ?? "--"}</td>
                  <td>{event.notes ?? ""}</td>
                </tr>
              ))}
              {raceEvents.length === 0 && <tr><td colSpan={5}>No driver swaps or battery changes recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
