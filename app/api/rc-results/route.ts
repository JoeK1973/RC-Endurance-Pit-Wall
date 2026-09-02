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

const cleanText = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();

const parseNumber = (value: string | undefined) => {
  if (!value) return null;

  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);

  return match ? Number(match[0]) : null;
};

const parseResult = (value: string | undefined) => {
  if (!value) return { laps: null, total: null };

  const match = value.match(
    /(\d+)\s*\/\s*(\d+(?:[.,]\d+)?)/
  );

  return {
    laps: match ? Number(match[1]) : null,
    total: match ? Number(match[2].replace(",", ".")) : null,
  };
};

function extractRows(html: string): string[][] {
  const rows: string[][] = [];
  const rowMatches = html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const rowMatch of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowMatch[1].matchAll(
      /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi
    );

    for (const cellMatch of cellMatches) {
      cells.push(cleanText(cellMatch[2]));
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

function findHeaderRow(rows: string[][]) {
  return rows.findIndex((row) => {
    const text = row.join(" ").toLowerCase();

    return (
      text.includes("car") &&
      (text.includes("driver") || text.includes("result"))
    );
  });
}

function indexFor(headers: string[], names: string[]) {
  return headers.findIndex((header) =>
    names.some(
      (name) =>
        header === name ||
        header.includes(name)
    )
  );
}

function parseTeams(html: string): LiveTeam[] {
  const rows = extractRows(html);
  const headerIndex = findHeaderRow(rows);

  if (headerIndex === -1) {
    return [];
  }

  const headers = rows[headerIndex].map((header) =>
    header.toLowerCase().replace(/\s+/g, "")
  );

  const positionIndex = indexFor(headers, [
    "pos",
    "position",
  ]);

  const carIndex = indexFor(headers, [
    "car",
    "carno",
    "number",
  ]);

  const driverIndex = indexFor(headers, [
    "driver",
    "name",
    "team",
  ]);

  const resultIndex = indexFor(headers, [
    "result",
  ]);

  const bestIndex = indexFor(headers, [
    "best",
  ]);

  const best10Index = indexFor(headers, [
    "best10",
    "average",
    "avg",
  ]);

  const teams: LiveTeam[] = [];

  for (
    let rowIndex = headerIndex + 1;
    rowIndex < rows.length;
    rowIndex += 1
  ) {
    const row = rows[rowIndex];

    /*
     * Stop at another table/header section.
     */
    if (
      row.join(" ").toLowerCase().includes("pos") &&
      row.join(" ").toLowerCase().includes("driver")
    ) {
      break;
    }

    const car =
      carIndex >= 0
        ? row[carIndex]
        : "";

    const driver =
      driverIndex >= 0
        ? row[driverIndex]
        : "";

    /*
     * A valid live result row must have a car number,
     * driver/team name, or a result.
     *
     * This deliberately rejects the header row "Car".
     */
    const result =
      resultIndex >= 0
        ? row[resultIndex]
        : "";

    if (
      !car &&
      !driver &&
      !result
    ) {
      continue;
    }

    const resultData =
      parseResult(result);

    /*
     * Prefer the actual Driver/Team field.
     * If the meeting only supplies a car number, use that
     * as a fallback rather than incorrectly returning "Car".
     */
    const name =
      driver ||
      (car ? `Car ${car}` : "");

    if (
      !name ||
      name.toLowerCase() === "car" ||
      name.toLowerCase() === "driver"
    ) {
      continue;
    }

    const position =
      positionIndex >= 0
        ? parseNumber(row[positionIndex])
        : null;

    teams.push({
      name,
      position,
      laps: resultData.laps,
      lastLap: null,
      bestLap:
        bestIndex >= 0
          ? parseNumber(row[bestIndex])
          : null,
      averageLap:
        best10Index >= 0
          ? parseNumber(row[best10Index])
          : null,
    });
  }

  /*
   * Remove duplicates while keeping the first occurrence.
   */
  return Array.from(
    new Map(
      teams.map((team) => [
        team.name.toLowerCase(),
        team,
      ])
    ).values()
  );
}

export async function GET(request: NextRequest) {
  const raceUrl =
    request.nextUrl.searchParams
      .get("url")
      ?.trim();

  if (!raceUrl) {
    return NextResponse.json(
      {
        error:
          "Missing RC-Results URL.",
      },
      { status: 400 }
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(raceUrl);
  } catch {
    return NextResponse.json(
      {
        error:
          "The RC-Results URL is invalid.",
      },
      { status: 400 }
    );
  }

  if (
    parsedUrl.protocol !== "https:" ||
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
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      parsedUrl.toString(),
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; RC-Endurance-Dashboard/1.0)",
          Accept:
            "text/html,application/xhtml+xml",
        },
        cache: "no-store",
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
  } catch (error) {
    console.error(
      "RC-Results fetch failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Could not fetch live data from RC-Results.",
      },
      { status: 502 }
    );
  }
}
