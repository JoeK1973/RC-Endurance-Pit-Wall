import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function hasFirebase() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}

let authReadyPromise: Promise<User> | null = null;

function getFirebase() {
  if (!hasFirebase()) {
    throw new Error(
      "Firebase is not configured. Add the NEXT_PUBLIC_FIREBASE_* environment variables."
    );
  }

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  if (!authReadyPromise) {
    authReadyPromise = new Promise<User>((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
          return;
        }

        try {
          const result = await signInAnonymously(auth);
          unsubscribe();
          resolve(result.user);
        } catch (error) {
          unsubscribe();
          reject(error);
        }
      }, reject);
    });
  }

  return { app, auth, firestore };
}

async function currentUser() {
  getFirebase();
  return authReadyPromise!;
}

function newId(firestore: ReturnType<typeof getFirestore>, collectionName: string) {
  return doc(collection(firestore, collectionName)).id;
}

function generateSessionCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function cleanData<T extends DocumentData>(id: string, data: T | undefined) {
  if (!data) return null;
  return { id, ...data } as T & { id: string };
}

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

async function ensureMembership(sessionId: string, sessionCode: string) {
  const { firestore } = getFirebase();
  const user = await currentUser();
  const membershipRef = doc(
    firestore,
    "sessions",
    sessionId,
    "members",
    user.uid,
  );

  const existing = await getDoc(membershipRef);
  if (!existing.exists()) {
    await runTransaction(firestore, async (transaction) => {
      const sessionRef = doc(firestore, "sessions", sessionId);
      const sessionSnap = await transaction.get(sessionRef);
      if (!sessionSnap.exists()) {
        throw new Error("Session not found.");
      }
      transaction.set(membershipRef, {
        uid: user.uid,
        sessionCode,
        joinedAt: new Date().toISOString(),
      });
    });
  }
}

type Filter = { field: string; op: "==" | "in"; value: unknown };

type Order = { field: string; direction: "asc" | "desc" };

class FirebaseQuery {
  private operation: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private filters: Filter[] = [];
  private idFilter: string | null = null;
  private orders: Order[] = [];
  private selectRequested = false;
  private singleMode: "single" | "maybeSingle" | null = null;
  private conflictField: string | null = null;

  constructor(
    private readonly firestore: ReturnType<typeof getFirestore>,
    private readonly collectionName: string,
  ) {}

  select(_columns = "*") {
    this.selectRequested = true;
    return this;
  }

  eq(field: string, value: unknown) {
    // The previous backend exposed the document primary key as an `id` column. Firestore
    // keeps that value as the document ID, not as a stored field, so handle
    // id equality directly against the document reference.
    if (field === "id") {
      this.idFilter = String(value);
    } else {
      this.filters.push({ field, op: "==", value });
    }
    return this;
  }

  in(field: string, values: unknown[]) {
    this.filters.push({ field, op: "in", value: values });
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orders.push({
      field,
      direction: options?.ascending === false ? "desc" : "asc",
    });
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }

  insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  upsert(
    payload: Record<string, unknown>,
    options?: { onConflict?: string },
  ) {
    this.operation = "upsert";
    this.payload = payload;
    this.conflictField = options?.onConflict ?? null;
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ) {
    return this.execute().catch(onrejected);
  }

  private async execute() {
    await currentUser();

    try {
      switch (this.operation) {
        case "insert":
          return await this.executeInsert();
        case "update":
          return await this.executeUpdate();
        case "delete":
          return await this.executeDelete();
        case "upsert":
          return await this.executeUpsert();
        default:
          return await this.executeSelect();
      }
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private buildQuery() {
    const constraints: QueryConstraint[] = [];
    for (const filter of this.filters) {
      constraints.push(where(filter.field, filter.op, filter.value));
    }
    for (const item of this.orders) {
      constraints.push(orderBy(item.field, item.direction));
    }
    return query(collection(this.firestore, this.collectionName), ...constraints);
  }

  private async executeSelect() {
    if (this.idFilter) {
      const snapshot = await getDoc(
        doc(this.firestore, this.collectionName, this.idFilter),
      );
      if (!snapshot.exists()) {
        if (this.singleMode === "single") {
          return { data: null, error: { message: "No matching document found." } };
        }
        return { data: this.singleMode === "maybeSingle" ? null : [], error: null };
      }

      const data = snapshot.data();
      const matches = this.filters.every((filter) => {
        if (filter.op === "==") return data[filter.field] === filter.value;
        if (filter.op === "in" && Array.isArray(filter.value)) {
          return filter.value.includes(data[filter.field]);
        }
        return false;
      });

      if (!matches) {
        if (this.singleMode === "single") {
          return { data: null, error: { message: "No matching document found." } };
        }
        return { data: this.singleMode === "maybeSingle" ? null : [], error: null };
      }

      const row = cleanData(snapshot.id, data);
      return { data: this.singleMode ? row : [row], error: null };
    }

    const snapshot = await getDocs(this.buildQuery());
    const rows = snapshot.docs.map((item) => cleanData(item.id, item.data()));

    if (this.singleMode === "single") {
      if (rows.length !== 1) {
        return {
          data: null,
          error: {
            message:
              rows.length === 0
                ? "No matching document found."
                : "Multiple matching documents found.",
          },
        };
      }
      return { data: rows[0], error: null };
    }

    if (this.singleMode === "maybeSingle") {
      if (rows.length > 1) {
        return {
          data: null,
          error: { message: "Multiple matching documents found." },
        };
      }
      return { data: rows[0] ?? null, error: null };
    }

    return { data: rows, error: null };
  }

  private async executeInsert() {
    const items = Array.isArray(this.payload) ? this.payload : [this.payload!];
    const batch = writeBatch(this.firestore);
    const ids: string[] = [];

    for (const item of items) {
      const id = newId(this.firestore, this.collectionName);
      ids.push(id);
      batch.set(doc(this.firestore, this.collectionName, id), {
        ...stripUndefined(item),
        created_at:
          item.created_at ??
          new Date().toISOString(),
      });
    }

    await batch.commit();

    if (!this.selectRequested) {
      return { data: null, error: null };
    }

    const itemsWithIds = items.map((item, index) => ({
      id: ids[index],
      ...stripUndefined(item),
      created_at:
        item.created_at ??
        new Date().toISOString(),
    }));

    return {
      data: Array.isArray(this.payload)
        ? itemsWithIds
        : itemsWithIds[0],
      error: null,
    };
  }

  private async executeUpdate() {
    if (this.idFilter) {
      const targetRef = doc(this.firestore, this.collectionName, this.idFilter);
      const updates = this.payload && !Array.isArray(this.payload) ? this.payload : {};

      // An ID-only update is safe to write directly. This avoids a read before
      // every Start/Pause/Resume/settings update. Extra filters still require
      // a read so the existing table-style semantics remain intact.
      if (this.filters.length === 0) {
        await updateDoc(targetRef, stripUndefined(updates));
        if (!this.selectRequested) return { data: null, error: null };
        return {
          data: cleanData(targetRef.id, { id: targetRef.id, ...stripUndefined(updates) }),
          error: null,
        };
      }

      const existing = await getDoc(targetRef);
      if (!existing.exists()) return { data: null, error: null };

      const data = existing.data();
      const matches = this.filters.every((filter) => {
        if (filter.op === "==") return data[filter.field] === filter.value;
        if (filter.op === "in" && Array.isArray(filter.value)) {
          return filter.value.includes(data[filter.field]);
        }
        return false;
      });
      if (!matches) return { data: null, error: null };

      await updateDoc(targetRef, stripUndefined(updates));

      if (!this.selectRequested) return { data: null, error: null };
      return {
        data: cleanData(targetRef.id, { ...data, ...stripUndefined(updates) }),
        error: null,
      };
    }

    const snapshot = await getDocs(this.buildQuery());
    if (snapshot.empty) {
      return { data: null, error: null };
    }

    const batch = writeBatch(this.firestore);
    const updates =
      this.payload && !Array.isArray(this.payload)
        ? this.payload
        : {};
    for (const item of snapshot.docs) {
      batch.update(item.ref, stripUndefined(updates));
    }
    await batch.commit();

    if (!this.selectRequested) {
      return { data: null, error: null };
    }

    const updated = snapshot.docs.map((item) =>
      cleanData(item.id, {
        ...item.data(),
        ...stripUndefined(updates),
      }),
    );
    return { data: this.singleMode ? updated[0] ?? null : updated, error: null };
  }

  private async executeDelete() {
    if (this.idFilter) {
      const targetRef = doc(this.firestore, this.collectionName, this.idFilter);

      // ID-only deletes can be issued directly. Firestore will return an error
      // only if the caller is not permitted to delete the document.
      if (this.filters.length === 0) {
        await deleteDoc(targetRef);
        return { data: null, error: null };
      }

      const existing = await getDoc(targetRef);
      if (!existing.exists()) return { data: null, error: null };

      const data = existing.data();
      const matches = this.filters.every((filter) => {
        if (filter.op === "==") return data[filter.field] === filter.value;
        if (filter.op === "in" && Array.isArray(filter.value)) {
          return filter.value.includes(data[filter.field]);
        }
        return false;
      });
      if (!matches) return { data: null, error: null };

      await deleteDoc(targetRef);
      return { data: null, error: null };
    }

    const snapshot = await getDocs(this.buildQuery());
    if (snapshot.empty) return { data: null, error: null };

    const batch = writeBatch(this.firestore);
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
    return { data: null, error: null };
  }

  private async executeUpsert() {
    const item = this.payload as Record<string, unknown>;
    const conflictField = this.conflictField;
    if (!conflictField || item[conflictField] === undefined) {
      return this.insert(item).select().executeInsert();
    }

    const existingSnapshot = await getDocs(
      query(
        collection(this.firestore, this.collectionName),
        where(conflictField, "==", item[conflictField]),
        limit(1),
      ),
    );

    if (existingSnapshot.empty) {
      return this.insert(item).select().executeInsert();
    }

    const existing = existingSnapshot.docs[0];
    await updateDoc(existing.ref, stripUndefined(item));
    return {
      data: cleanData(existing.id, { ...existing.data(), ...stripUndefined(item) }),
      error: null,
    };
  }
}

class FirebaseChannel {
  private listeners: Unsubscribe[] = [];
  private registrations: Array<{
    table: string;
    filter?: string;
    callback: (changes: FirebaseRealtimeChange[]) => void;
  }> = [];

  constructor(private readonly firestore: ReturnType<typeof getFirestore>) {}

  on(
    event: string,
    config: { table: string; filter?: string },
    callback: (changes: FirebaseRealtimeChange[]) => void,
  ) {
    if (event === "postgres_changes") {
      this.registrations.push({
        table: config.table,
        filter: config.filter,
        callback: (changes) =>
          callback(changes.map((change) => ({ ...change, table: config.table }))),
      });
    }
    return this;
  }

  subscribe() {
    void this.start();
    return this;
  }

  private async start() {
    await currentUser();
    for (const registration of this.registrations) {
      const sessionId = registration.filter?.match(/session_id=eq\.(.+)$/)?.[1];
      if (!sessionId) continue;

      const q = query(
        collection(this.firestore, registration.table),
        where("session_id", "==", sessionId),
      );

      let firstSnapshot = true;
      const unsubscribe = onSnapshot(q, (snapshot) => {
        // The initial snapshot is already loaded by loadSession(). Skipping it
        // avoids an immediate second full read of every session collection.
        if (firstSnapshot) {
          firstSnapshot = false;
          return;
        }

        const changes: FirebaseRealtimeChange[] = snapshot.docChanges().map((change) => ({
          table: registration.table,
          type: change.type,
          id: change.doc.id,
          data: change.doc.data(),
        }));

        if (changes.length) {
          registration.callback(changes);
        }
      });
      this.listeners.push(unsubscribe);
    }
  }

  unsubscribe() {
    this.listeners.forEach((unsubscribe) => unsubscribe());
    this.listeners = [];
  }
}

export type FirebaseRealtimeChange = {
  table: string;
  type: "added" | "modified" | "removed";
  id: string;
  data: DocumentData;
};

async function createRaceSession() {
  const { firestore } = getFirebase();
  const user = await currentUser();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateSessionCode();
    const sessionRef = doc(collection(firestore, "sessions"));
    const codeRef = doc(firestore, "sessionCodes", code);
    const raceRef = doc(collection(firestore, "races"));
    const memberRef = doc(firestore, "sessions", sessionRef.id, "members", user.uid);

    try {
      await runTransaction(firestore, async (transaction) => {
        const codeSnapshot = await transaction.get(codeRef);
        if (codeSnapshot.exists()) {
          throw new Error("SESSION_CODE_COLLISION");
        }

        transaction.set(sessionRef, {
          session_code: code,
          owner_uid: user.uid,
          created_at: new Date().toISOString(),
        });

        transaction.set(codeRef, {
          session_id: sessionRef.id,
          session_code: code,
        });


      });

      await runTransaction(firestore, async (transaction) => {
        transaction.set(raceRef, {
          session_id: sessionRef.id,
          duration_seconds: 4 * 60 * 60,
          strategy_average_lap: 18,
          strategy_battery_endurance: 20,
          strategy_swap_time: 30,
          stint_target_minutes: 20,
          stint_alert_minutes: 3,
          audio_alerts: true,
          auto_start_from_live: false,
          show_battery_change: true,
          show_driver_change: true,
          show_full_change: true,
          status: "idle",
          started_at: null,
          paused_at: null,
          accumulated_pause_seconds: 0,
          current_driver_id: null,
          current_stint_started_at: null,
          activity_rotation: 0,
          active_stint_id: null,
        });
      });

      await runTransaction(firestore, async (transaction) => {
        transaction.set(memberRef, {
          uid: user.uid,
          sessionCode: code,
          joinedAt: new Date().toISOString(),
        });
      });

      return { data: { session_code: code }, error: null };
    } catch (error) {
      if (error instanceof Error && error.message === "SESSION_CODE_COLLISION") continue;
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  return {
    data: null,
    error: { message: "Could not generate a unique session code." },
  };
}

export function createClient() {
  const { firestore } = getFirebase();

  return {
    from(table: string) {
      if (table === "race_sessions") {
        return new FirebaseSessionLookup(firestore);
      }
      return new FirebaseQuery(firestore, table);
    },
    channel(_name: string) {
      return new FirebaseChannel(firestore);
    },
    removeChannel(channel: FirebaseChannel) {
      channel.unsubscribe();
      return Promise.resolve({ error: null });
    },
    rpc(name: string) {
      if (name === "create_race_session") {
        return createRaceSession();
      }
      return Promise.resolve({
        data: null,
        error: { message: `Unknown Firebase RPC: ${name}` },
      });
    },
  };
}

class FirebaseSessionLookup {
  private singleMode: "single" | "maybeSingle" | null = null;
  private code = "";

  constructor(private readonly firestore: ReturnType<typeof getFirestore>) {}

  select(_columns = "*") {
    return this;
  }

  eq(field: string, value: unknown) {
    if (field === "session_code") this.code = String(value).trim().toUpperCase();
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ) {
    return this.execute().catch(onrejected);
  }

  private async execute() {
    try {
      await currentUser();
      if (!this.code) {
        return { data: null, error: { message: "Session code is required." } };
      }

      const codeSnapshot = await getDoc(doc(this.firestore, "sessionCodes", this.code));
      if (!codeSnapshot.exists()) {
        return { data: null, error: { message: "Session not found." } };
      }

      const mapping = codeSnapshot.data();
      const sessionId = String(mapping.session_id);
      const sessionSnapshot = await getDoc(doc(this.firestore, "sessions", sessionId));
      if (!sessionSnapshot.exists()) {
        return { data: null, error: { message: "Session not found." } };
      }

      await ensureMembership(sessionId, this.code);

      const data = cleanData(sessionSnapshot.id, sessionSnapshot.data());
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  }
}
