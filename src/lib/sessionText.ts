/** 세션 본문을 클립보드용 한 줄당 한 바코드 문자열로 정규화 */
export function toPlainSessionText(text: string): string {
  return text
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .join("\n");
}

export function countSessionLines(text: string): number {
  return text.split("\n").filter((x) => x.trim().length > 0).length;
}
