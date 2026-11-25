export type CalendarMonthPointer = {
  year: number;
  month: number;
};

export type CalendarDayCell = {
  date: string;
  day: number;
  inCurrentMonth: boolean;
};

export type CalendarMonth = CalendarMonthPointer & {
  label: string;
  cells: CalendarDayCell[];
};

export function buildCalendarMonth(year: number, month: number): CalendarMonth {
  const firstOfMonth = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - firstOfMonth.getDay());
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      date: toIsoDate(date),
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === month - 1
    };
  });

  return {
    year,
    month,
    label: `${year}년 ${month}월`,
    cells
  };
}

export function shiftCalendarMonth(pointer: CalendarMonthPointer, offset: number): CalendarMonthPointer {
  const date = new Date(pointer.year, pointer.month - 1 + offset, 1);

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1
  };
}

export function toMonthInputValue(pointer: CalendarMonthPointer): string {
  return `${pointer.year}-${String(pointer.month).padStart(2, "0")}`;
}

export function fromMonthInputValue(value: string): CalendarMonthPointer {
  const [year, month] = value.split("-").map(Number);

  return {
    year,
    month
  };
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
