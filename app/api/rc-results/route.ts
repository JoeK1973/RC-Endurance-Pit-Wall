import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LiveTeam = {
  name: string;
  position: number | null;
  laps: number | null;
  lastLap: number | null;
  bestLap: number | null;
  averageLap: number | null;
  resultTotal: number | null;
};

type LiveLap = {
  lapNumber: number;
  lapTime: number;
};

const cleanText = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();

const headerKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const parseNumber = (value?: string) => {
  if (!value) return null;
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const parseTime = (value?: string) => {
  if (!value) return null;
  const cleaned = value.trim().replace(",", ".");
  if (!cleaned || cleaned === "--" || cleaned === "-") return null;

  if (/^\d+(?:\.\d+)?$/.test(cleaned)) {
    const seconds = Number(cleaned);
    return Number.isFinite(seconds) ? seconds : null;
  }

  const parts = cleaned.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
};

const parseResult = (value?: string) => {
  if (!value) return { laps: null, total: null };

  const match = value.match(
    /^\s*(\d+)\s*\/\s*(.+?)\s*$/
  );

  if (!match) return { laps: null, total: null };

  return {
    laps: Number(match[1]),
    total: parseTime(match[2]),
  };
};

function extractRows(html: string): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];

    for (const cellMatch of rowMatch[1].matchAll(
      /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi
    )) {
      cells.push(cleanText(cellMatch[2]));
    }

    if (cells.length > 0) rows.push(cells);
  }

  return rows;
}

function parseTeams(html: string): LiveTeam[] {
  const rows = extractRows(html);

  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(headerKey);
    return (
      headers.includes("car") &&
      headers.includes("driver") &&
      headers.includes("result")
    );
  });

  if (headerIndex === -1) return [];

  const headers = rows[headerIndex].map(headerKey);

  const indexOf = (...names: string[]) =>
    headers.findIndex((header) => names.includes(header));

  const positionIndex = indexOf("pos", "position");
  const carIndex = indexOf("car", "carno", "number");
  const driverIndex = indexOf("driver", "name", "team");
  const resultIndex = indexOf("result");

  /*
   * Exact matching is important:
   * "Best10" must not be selected when looking for "Best".
   */
  const bestIndex = indexOf("best", "bestlap");
  const best10Index = indexOf("best10");

  const teams: LiveTeam[] = [];

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];

    const car = carIndex >= 0 ? row[carIndex] ?? "" : "";
    const driver =
      driverIndex >= 0 ? row[driverIndex] ?? "" : "";
    const result =
      resultIndex >= 0 ? row[resultIndex] ?? "" : "";

    if (!car && !driver && !result) continue;

    const name = driver || (car ? `Car ${car}` : "");

    if (
      !name ||
      ["car", "driver", "team"].includes(name.toLowerCase())
    ) {
      continue;
    }

    const resultData = parseResult(result);

    teams.push({
      name,
      position:
        positionIndex >= 0
          ? parseNumber(row[positionIndex])
          : null,
      laps: resultData.laps,
      resultTotal: resultData.total,

      /*
       * The supplied RC-Results table has no Last Lap column.
       * Last Lap is therefore calculated in page.tsx from the
       * newest captured lap.
       */
      lastLap: null,

      /*
       * Correctly read the "Best" column, not "Best10".
       */
      bestLap:
        bestIndex >= 0
          ? parseTime(row[bestIndex])
          : null,

      /*
       * Best10 is kept as a fallback. The dashboard calculates
       * its displayed average from all captured lap times.
       */
      averageLap:
        best10Index >= 0
          ? parseTime(row[best10Index])
          : null,
    });
  }

  return Array.from(
    new Map(
      teams.map((team) => [team.name.toLowerCase(), team])
    ).values()
  );
}

export async function GET(request: NextRequest) {
  const raceUrl = request.nextUrl.searchParams.get("url")?.trim();
  const requestedTeam =
    request.nextUrl.searchParams.get("team")?.trim();

  if (!raceUrl) {
    return NextResponse.json(
      { error: "Missing RC-Results URL." },
      { status: 400 }
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(raceUrl);
  } catch {
    return NextResponse.json(
      { error: "The RC-Results URL is invalid." },
      { status: 400 }
    );
  }

  if (
    parsedUrl.protocol !== "https:" ||
    !["rc-results.com", "www.rc-results.com"].includes(
      parsedUrl.hostname
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Please use an https://rc-results.com live race URL.",
      },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RC-Endurance-Dashboard/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `RC-Results returned ${response.status}.` },
        { status: 502 }
      );
    }

    const html = await response.text();
    const teams = parseTeams(html);

    if (!requestedTeam) {
      return NextResponse.json(
        {
          teams,
          message:
            teams.length > 0
              ? undefined
              : "No live race rows were found.",
        },
        {
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    const requested = requestedTeam.toLowerCase();

    const team =
      teams.find(
        (item) => item.name.toLowerCase() === requested
      ) ??
      teams.find(
        (item) =>
          item.name.toLowerCase().includes(requested)
      );

    if (!team) {
      return NextResponse.json(
        {
          error: `Could not find "${requestedTeam}" in the current RC-Results data.`,
          teams,
        },
        { status: 404 }
      );
    }

    /*
     * Individual laps are supplied by any live-lap field that
     * the source exposes. For this table, the page-level tracker
     * calculates Last/Best/Average from captured laps.
     */
    const lapData: LiveLap[] =
      team.laps !== null &&
      team.laps > 0 &&
      team.lastLap !== null &&
      team.lastLap > 0
        ? [
            {
              lapNumber: team.laps,
              lapTime: team.lastLap,
            },
          ]
        : [];

    return NextResponse.json(
      {
        teams,
        team,
        lapData,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error("RC-Results fetch failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not fetch live data from RC-Results.",
      },
      { status: 502 }
    );
  }
}
