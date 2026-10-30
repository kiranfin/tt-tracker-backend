export function getDefaultSeasonDates(season: string) {
    const match = /^(\d{2})--(\d{2})$/.exec(season);

    if (!match) {
        return {
            dateStart: undefined,
            dateEnd: undefined
        };
    }

    const startYear = 2000 + Number(match[1]);
    const endYear = 2000 + Number(match[2]);

    return {
        dateStart: `${startYear}-07-01`,
        dateEnd: `${endYear}-06-30`
    };
}

// Saison wechselt zum 1. Juli, Format wie in den click-tt URLs ("26--27").
export function getCurrentSeasonSegment(now = new Date()) {
    const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const short = (year: number) => String(year % 100).padStart(2, "0");

    return `${short(startYear)}--${short(startYear + 1)}`;
}
