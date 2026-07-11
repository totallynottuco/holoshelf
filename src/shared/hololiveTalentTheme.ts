import { getHololiveCanonicalTalentIdentity } from "./hololiveTalentIdentity";

export interface HololiveTalentTheme {
  primary: string;
  secondary: string;
}

const DEFAULT_HOLOLIVE_TALENT_THEME: HololiveTalentTheme = {
  primary: "#314d5d",
  secondary: "#83b4c8"
};

const HOLOLIVE_TALENT_THEME_COLORS: Record<string, string> = {
  "tokino-sora": "#4aa8ff",
  "roboco-san": "#8fb4c9",
  "aki-rosenthal": "#d99a55",
  "akai-haato": "#d93c50",
  "shirakami-fubuki": "#6fd6f7",
  "natsuiro-matsuri": "#f3a33d",
  "nakiri-ayame": "#d95070",
  "yuzuki-choco": "#d06b9f",
  "oozora-subaru": "#f0c64a",
  azki: "#ef5e9a",
  "ookami-mio": "#252a36",
  sakuramiko: "#ff8bb3",
  "nekomata-okayu": "#b869e6",
  "inugami-korone": "#f4c84a",
  "hoshimachi-suisei": "#40c8ee",
  "usada-pekora": "#78d9ee",
  "shiranui-flare": "#f0b14b",
  "shirogane-noel": "#d6d8e2",
  "houshou-marine": "#d42431",
  "tsunomaki-watame": "#f4d76a",
  "tokoyami-towa": "#b68cff",
  "himemori-luna": "#ff9bc8",
  "yukihana-lamy": "#8ed8ff",
  "momosuzu-nene": "#ff9f43",
  "shishiro-botan": "#b8d6ee",
  "omaru-polka": "#e84352",
  "la-darknesss": "#6f55c9",
  "takane-lui": "#9c2740",
  "hakui-koyori": "#f3a6c5",
  "kazama-iroha": "#6bbf84",
  "sakamata-chloe": "#d4475c",
  "ayunda-risu": "#f05d6d",
  "moona-hoshinova": "#7759c7",
  "airani-iofifteen": "#8bd54f",
  "kureiji-ollie": "#e32d43",
  "anya-melfissa": "#d7a44f",
  "pavolia-reine": "#7b6ad7",
  "vestia-zeta": "#7ea4d8",
  "kaela-kovalskia": "#d64a48",
  "kobo-kanaeru": "#55bceb",
  "mori-calliope": "#d6144b",
  "takanashi-kiara": "#f28c2e",
  "ninomae-inanis": "#6d4ebd",
  "watson-amelia": "#f0c15a",
  irys: "#d45c83",
  "ouro-kronii": "#384a9e",
  "hakos-baelz": "#f34846",
  "shiori-novella": "#6b4ed8",
  "koseki-bijou": "#5cc8ff",
  "nerissa-ravencroft": "#4e55b8",
  fuwamoco: "#68c7ff",
  "fuwawa-abyssgard": "#68c7ff",
  "mococo-abyssgard": "#f7a1c8",
  "elizabeth-rose-bloodflame": "#d92642",
  "gigi-murin": "#f0c24e",
  "cecilia-immergreen": "#68c597",
  "raora-panthera": "#e96a84",
  "otonose-kanade": "#f0d464",
  "ichijou-ririka": "#e94d7a",
  "juufuutei-raden": "#7d4bc7",
  "todoroki-hajime": "#6378d8",
  "isaki-riona": "#ff8c3e",
  "koganei-niko": "#f3cf55",
  "mizumiya-su": "#64c8e8",
  "rindo-chihaya": "#2f63c7",
  "kikirara-vivi": "#e9a4d0",
  "minato-aqua": "#71d8ff",
  "murasaki-shion": "#a266e8",
  "amane-kanata": "#9fd8ff",
  "kiryu-coco": "#f28f44",
  "gawr-gura": "#4a8fdc",
  "tsukumo-sana": "#f3ad44",
  "ceres-fauna": "#78c56d",
  "nanashi-mumei": "#a88a64",
  "hiodoshi-ao": "#3f7be0"
};

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function normalizeThemeColor(color: string | undefined): string | null {
  const value = color?.trim();
  return value && HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
}

function parseHexColor(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16)
  ];
}

function formatHexChannel(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, "0");
}

function mixHexColor(color: string, targetColor: string, amount: number): string {
  const [red, green, blue] = parseHexColor(color);
  const [targetRed, targetGreen, targetBlue] = parseHexColor(targetColor);
  const clampedAmount = Math.max(0, Math.min(1, amount));
  return `#${formatHexChannel(red + (targetRed - red) * clampedAmount)}${formatHexChannel(
    green + (targetGreen - green) * clampedAmount
  )}${formatHexChannel(blue + (targetBlue - blue) * clampedAmount)}`;
}

export function resolveHololiveTalentTheme(id: string | null | undefined, name?: string | null): HololiveTalentTheme {
  const normalizedId = id?.trim() ?? "";
  const canonical = getHololiveCanonicalTalentIdentity(normalizedId, name);
  const mappedPrimary =
    normalizeThemeColor(HOLOLIVE_TALENT_THEME_COLORS[normalizedId]) ??
    normalizeThemeColor(HOLOLIVE_TALENT_THEME_COLORS[canonical.id]);

  if (!mappedPrimary) {
    return DEFAULT_HOLOLIVE_TALENT_THEME;
  }

  return {
    primary: mappedPrimary,
    secondary: mixHexColor(mappedPrimary, "#ffffff", 0.28)
  };
}
