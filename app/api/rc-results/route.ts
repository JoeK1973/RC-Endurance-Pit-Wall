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
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

/*
 * Parse either:
 *
 * 18.234
 * 1:18.234
 * 01:18.234
 * 1:02:18.234
 *
 * into seconds.
 */
const parseTime = (
  value: string | undefined
): number | null => {
  if (!value) {
    return null;
  }

  const cleaned = value
    .trim()
    .replace(",", ".");

  if (!cleaned) {
    return null;
  }

  /*
   * Plain seconds.
   */
  if (
    /^\d+(?:\.\d+)?$/.test(cleaned)
  ) {
    const number =
      Number(cleaned);

    return Number.isFinite(number)
      ? number
      : null;
  }

  const parts =
    cleaned
      .split(":")
      .map((part) =>
        Number(part)
      );

  if (
    parts.some(
      (part) =>
        !Number.isFinite(part)
    )
  ) {
    return null;
  }

  if (parts.length === 2) {
    return (
      parts[0] * 60 +
      parts[1]
    );
  }

  if (parts.length === 3) {
    return (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    );
  }

  return null;
};

const parseNumber = (
  value: string | undefined
): number | null => {
  if (!value) {
    return null;
  }

  const match =
    value
      .replace(",", ".")
      .match(
        /-?\d+(?:\.\d+)?/
      );

  return match
    ? Number(match[0])
    : null;
};

/*
 * RC-Results commonly displays results in forms such as:
 *
 * 125 / 30:01.234
 * 125/30:01.234
 *
 * We only need the completed lap count here.
 */
const parseResult = (
  value: string | undefined
) => {
  if (!value) {
    return {
      laps: null,
    };
  }

  const match =
    value.match(
      /^\s*(\d+)\s*\//
    );

  return {
    laps: match
      ? Number(match[1])
      : null,
  };
};

function extractRows(
  html: string
): string[][] {
  const rows: string[][] =
    [];

  const rowMatches =
    html.matchAll(
      /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    );

  for (
    const rowMatch
    of rowMatches
  ) {
    const cells: string[] =
      [];

    const cellMatches =
      rowMatch[1].matchAll(
        /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi
      );

    for (
      const cellMatch
      of cellMatches
    ) {
      cells.push(
        cleanText(
          cellMatch[2]
        )
      );
    }

    if (
      cells.length > 0
    ) {
      rows.push(cells);
    }
  }

  return rows;
}

function findHeaderRow(
  rows: string[][]
) {
  return rows.findIndex(
    (row) => {
      const text =
        row
          .join(" ")
          .toLowerCase();

      return (
        text.includes("car") &&
        (
          text.includes("driver") ||
          text.includes("result")
        )
      );
    }
  );
}

function indexFor(
  headers: string[],
  names: string[]
) {
  return headers.findIndex(
    (header) =>
      names.some(
        (name) =>
          header === name ||
          header.includes(name)
      )
  );
}

function parseTeams(
  html: string
): LiveTeam[] {
  const rows =
    extractRows(html);

  const headerIndex =
    findHeaderRow(rows);

  if (
    headerIndex === -1
  ) {
    return [];
  }

  const headers =
    rows[headerIndex].map(
      (header) =>
        header
          .toLowerCase()
          .replace(
            /\s+/g,
            ""
          )
    );

  const positionIndex =
    indexFor(
      headers,
      [
        "pos",
        "position",
      ]
    );

  const carIndex =
    indexFor(
      headers,
      [
        "car",
        "carno",
        "number",
      ]
    );

  const driverIndex =
    indexFor(
      headers,
      [
        "driver",
        "name",
        "team",
      ]
    );

  const resultIndex =
    indexFor(
      headers,
      [
        "result",
      ]
    );

  const lastLapIndex =
    indexFor(
      headers,
      [
        "last",
        "lastlap",
        "lap",
      ]
    );

  const bestIndex =
    indexFor(
      headers,
      [
        "best",
        "bestlap",
      ]
    );

  const averageIndex =
    indexFor(
      headers,
      [
        "best10",
        "average",
        "avg",
      ]
    );

  const teams: LiveTeam[] =
    [];

  for (
    let rowIndex =
      headerIndex + 1;

    rowIndex <
    rows.length;

    rowIndex += 1
  ) {
    const row =
      rows[rowIndex];

    const rowText =
      row
        .join(" ")
        .toLowerCase();

    /*
     * Stop when another results header
     * starts.
     */
    if (
      rowText.includes("pos") &&
      rowText.includes("driver") &&
      rowText.includes("car")
    ) {
      break;
    }

    const car =
      carIndex >= 0
        ? row[carIndex] ?? ""
        : "";

    const driver =
      driverIndex >= 0
        ? row[driverIndex] ?? ""
        : "";

    const result =
      resultIndex >= 0
        ? row[resultIndex] ?? ""
        : "";

    /*
     * Ignore empty rows.
     */
    if (
      !car &&
      !driver &&
      !result
    ) {
      continue;
    }

    const name =
      driver ||
      (
        car
          ? `Car ${car}`
          : ""
      );

    /*
     * Never accidentally return
     * table headings as teams.
     */
    if (
      !name ||
      name.toLowerCase() ===
        "car" ||
      name.toLowerCase() ===
        "driver" ||
      name.toLowerCase() ===
        "team"
    ) {
      continue;
    }

    const resultData =
      parseResult(result);

    const position =
      positionIndex >= 0
        ? parseNumber(
            row[positionIndex]
          )
        : null;

    const lastLap =
      lastLapIndex >= 0
        ? parseTime(
            row[lastLapIndex]
          )
        : null;

    const bestLap =
      bestIndex >= 0
        ? parseTime(
            row[bestIndex]
          )
        : null;

    const averageLap =
      averageIndex >= 0
        ? parseTime(
            row[averageIndex]
          )
        : null;

    teams.push({
      name,
      position,
      laps:
        resultData.laps,
      lastLap,
      bestLap,
      averageLap,
    });
  }

  /*
   * Remove duplicate teams.
   */
  return Array.from(
    new Map(
      teams.map(
        (team) => [
          team.name
            .toLowerCase(),
          team,
        ]
      )
    ).values()
  );
}

export async function GET(
  request: NextRequest
) {
  const raceUrl =
    request.nextUrl.searchParams
      .get("url")
      ?.trim();

  const requestedTeam =
    request.nextUrl.searchParams
      .get("team")
      ?.trim();

  if (!raceUrl) {
    return NextResponse.json(
      {
        error:
          "Missing RC-Results URL.",
      },
      {
        status: 400,
      }
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl =
      new URL(raceUrl);
  } catch {
    return NextResponse.json(
      {
        error:
          "The RC-Results URL is invalid.",
      },
      {
        status: 400,
      }
    );
  }

  if (
    parsedUrl.protocol !==
      "https:" ||
    !(
      parsedUrl.hostname ===
        "rc-results.com" ||
      parsedUrl.hostname ===
        "www.rc-results.com"
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Please use an https://rc-results.com live race URL.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const response =
      await fetch(
        parsedUrl.toString(),
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; RC-Endurance-Dashboard/1.0)",
            Accept:
              "text/html,application/xhtml+xml",
          },
          cache:
            "no-store",
        }
      );

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            `RC-Results returned ${response.status}.`,
        },
        {
          status: 502,
        }
      );
    }

    const html =
      await response.text();

    const teams =
      parseTeams(html);

    /*
     * FIND TEAMS request.
     */
    if (!requestedTeam) {
      return NextResponse.json(
        {
          teams,
          message:
            teams.length > 0
              ? undefined
              : "No live race rows were found. Make sure the race is currently available on RC-Results.",
        },
        {
          headers: {
            "Cache-Control":
              "no-store, max-age=0",
          },
        }
      );
    }

    /*
     * Find the selected team.
     */
    const team =
      teams.find(
        (item) =>
          item.name
            .toLowerCase()
            .trim() ===
          requestedTeam
            .toLowerCase()
            .trim()
      ) ??
      teams.find(
        (item) =>
          item.name
            .toLowerCase()
            .includes(
              requestedTeam
                .toLowerCase()
                .trim()
            )
      );

    if (!team) {
      return NextResponse.json(
        {
          error:
            `Could not find "${requestedTeam}" in the current RC-Results data.`,
          teams,
        },
        {
          status: 404,
        }
      );
    }

    /*
     * IMPORTANT:
     *
     * RC-Results live pages provide a live total
     * and last-lap value in the results table.
     *
     * We turn the CURRENT completed lap into a lap
     * object. The dashboard already remembers lap
     * numbers it has saved, so on the next poll:
     *
     * Lap 120 -> saved
     * Lap 120 -> ignored
     * Lap 121 -> saved
     *
     * This lets the dashboard track every newly
     * completed lap while polling.
     */
    const lapData: LiveLap[] =
      (
        team.laps !== null &&
        team.laps > 0 &&
        team.lastLap !== null &&
        team.lastLap > 0
      )
        ? [
            {
              lapNumber:
                team.laps,
              lapTime:
                team.lastLap,
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
          "Cache-Control":
            "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error(
      "RC-Results fetch failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not fetch live data from RC-Results.",
      },
      {
        status: 502,
      }
    );
  }
}
