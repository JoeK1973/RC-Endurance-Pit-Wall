import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Team = {
  name: string;
  position?: number | null;
  laps?: number | null;
  lastLap?: number | null;
  bestLap?: number | null;
  averageLap?: number | null;
  driverResultUrl?: string | null;
};

type Lap = {
  lapNumber: number;
  lapTime: number;
};

function parseTime(value: string): number | null {
  const text = value.trim().replace(",", ".");

  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }

  const parts = text.split(":");

  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);

    if (
      Number.isFinite(minutes) &&
      Number.isFinite(seconds)
    ) {
      return minutes * 60 + seconds;
    }
  }

  return null;
}

function clean(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(
  value: string,
  base: string
): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function extractDriverLinks(
  html: string,
  baseUrl: string
): Team[] {
  const teams: Team[] = [];

  const regex =
    /href=["']([^"']*DriverResult[^"']*driverId=(\d+)[^"']*)["'][^>]*>(.*?)<\/a>/gi;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(html))) {
    const name = clean(match[3]);

    if (!name) continue;

    const url = absoluteUrl(
      match[1],
      baseUrl
    );

    if (
      !teams.some(
        (team) =>
          team.name === name &&
          team.driverResultUrl === url
      )
    ) {
      teams.push({
        name,
        driverResultUrl: url,
      });
    }
  }

  return teams;
}

function extractTableRows(
  html: string
): string[][] {
  const rows: string[][] = [];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html))) {
    const cells: string[] = [];

    const cellRegex =
      /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;

    let cellMatch: RegExpExecArray | null;

    while (
      (cellMatch =
        cellRegex.exec(rowMatch[1]))
    ) {
      cells.push(clean(cellMatch[1]));
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

function extractTeamsFromTables(
  html: string,
  baseUrl: string
): Team[] {
  const teams: Team[] = [];
  const rows = extractTableRows(html);

  for (const cells of rows) {
    if (cells.length < 2) continue;

    const positionText = cells[0];
    const name = cells[1];

    if (!name || name.length < 2) {
      continue;
    }

    const position =
      /^\d+$/.test(positionText)
        ? Number(positionText)
        : null;

    let laps: number | null = null;
    let lastLap: number | null = null;
    let bestLap: number | null = null;

    for (const cell of cells.slice(2)) {
      const resultMatch =
        cell.match(/(\d+)\s*\/\s*[\d:.]+/);

      if (resultMatch && laps === null) {
        laps = Number(resultMatch[1]);
      }

      const time = parseTime(cell);

      if (
        time !== null &&
        time > 0 &&
        time < 3600
      ) {
        if (lastLap === null) {
          lastLap = time;
        } else if (
          bestLap === null ||
          time < bestLap
        ) {
          bestLap = time;
        }
      }
    }

    teams.push({
      name,
      position,
      laps,
      lastLap,
      bestLap,
      driverResultUrl: null,
    });
  }

  const links = extractDriverLinks(
    html,
    baseUrl
  );

  return teams.map((team) => {
    const linked = links.find(
      (item) => item.name === team.name
    );

    return {
      ...team,
      driverResultUrl:
        linked?.driverResultUrl ?? null,
    };
  });
}

function parseDriverResult(
  html: string
): Lap[] {
  const rows = extractTableRows(html);
  const laps: Lap[] = [];

  for (const cells of rows) {
    if (cells.length < 2) continue;

    const lapNumber = Number(cells[0]);

    const lapTime = parseTime(cells[1]);

    if (
      Number.isInteger(lapNumber) &&
      lapNumber > 0 &&
      lapTime !== null &&
      lapTime > 0
    ) {
      laps.push({
        lapNumber,
        lapTime,
      });
    }
  }

  return laps.sort(
    (a, b) =>
      a.lapNumber - b.lapNumber
  );
}

async function fetchPage(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 RC Endurance Dashboard",
      Accept:
        "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(
      `RC-Results returned ${response.status}`
    );
  }

  return response.text();
}

export async function GET(
  request: NextRequest
) {
  const searchParams =
    request.nextUrl.searchParams;

  const raceUrl =
    searchParams.get("url");

  const teamName =
    searchParams.get("team");

  if (!raceUrl) {
    return NextResponse.json(
      {
        error:
          "Missing RC-Results race URL.",
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
        error: "Invalid race URL.",
      },
      { status: 400 }
    );
  }

  if (
    !parsedUrl.hostname.endsWith(
      "rc-results.com"
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Only rc-results.com URLs are supported.",
      },
      { status: 400 }
    );
  }

  try {
    const html = await fetchPage(
      parsedUrl.toString()
    );

    const linkedTeams =
      extractDriverLinks(
        html,
        parsedUrl.toString()
      );

    const tableTeams =
      extractTeamsFromTables(
        html,
        parsedUrl.toString()
      );

    const combinedTeams = [
      ...linkedTeams,
      ...tableTeams,
    ].filter(
      (team, index, array) =>
        array.findIndex(
          (item) =>
            item.name === team.name
        ) === index
    );

    if (!teamName) {
      return NextResponse.json({
        sourceUrl:
          parsedUrl.toString(),
        teams: combinedTeams,
        message:
          combinedTeams.length > 0
            ? "Select the team to track."
            : "No team entries could be extracted from this page. Try the exact race results page rather than the meeting summary.",
      });
    }

    const selectedTeam =
      combinedTeams.find(
        (team) =>
          team.name.toLowerCase() ===
          teamName.toLowerCase()
      );

    if (!selectedTeam) {
      return NextResponse.json(
        {
          error:
            "Selected team was not found in the latest RC-Results data.",
          teams: combinedTeams,
        },
        { status: 404 }
      );
    }

    let laps: Lap[] = [];

    if (
      selectedTeam.driverResultUrl
    ) {
      const driverHtml =
        await fetchPage(
          selectedTeam.driverResultUrl
        );

      laps =
        parseDriverResult(driverHtml);
    }

    const bestLap =
      laps.length > 0
        ? Math.min(
            ...laps.map(
              (lap) => lap.lapTime
            )
          )
        : selectedTeam.bestLap ?? null;

    const averageLap =
      laps.length > 0
        ? laps.reduce(
            (total, lap) =>
              total + lap.lapTime,
            0
          ) / laps.length
        : selectedTeam.averageLap ?? null;

    return NextResponse.json({
      sourceUrl:
        parsedUrl.toString(),

      team: {
        ...selectedTeam,
        laps:
          laps.length > 0
            ? laps.length
            : selectedTeam.laps,
        lastLap:
          laps.length > 0
            ? laps[laps.length - 1]
                .lapTime
            : selectedTeam.lastLap,
        bestLap,
        averageLap,
      },

      lapData: laps,

      fetchedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not fetch RC-Results.";

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}
