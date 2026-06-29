import type { HololiveIdol, HololiveTier } from "../../shared/contracts";
import { HOLOLIVE_IDOL_PROFILE_OVERRIDES } from "./profileData";

export const HOLOLIVE_DEFAULT_BOARD_ID = "hololive-idol-ranking";
export const DEFAULT_HOLOLIVE_BOARD_NAME = "tier list 1";

export const DEFAULT_HOLOLIVE_TIERS: Array<Pick<HololiveTier, "id" | "label" | "color" | "position" | "collapsed">> =
  [
    { id: "tier-s", label: "S", color: "#2f8fd7", position: 0, collapsed: false },
    { id: "tier-a", label: "A", color: "#2f8f5b", position: 1, collapsed: false },
    { id: "tier-b", label: "B", color: "#91d96f", position: 2, collapsed: false },
    { id: "tier-c", label: "C", color: "#f2d45c", position: 3, collapsed: false },
    { id: "tier-d", label: "D", color: "#f08a35", position: 4, collapsed: false },
    { id: "tier-f", label: "F", color: "#e14d63", position: 5, collapsed: false }
  ];

type OfficialHololiveIdolSeed = Omit<HololiveIdol, "source">;

const HOLOLIVE_IDOL_ROSTER: OfficialHololiveIdolSeed[] = [
  {
    id: "tokino-sora",
    slug: "tokino-sora",
    displayName: "Tokino Sora",
    branch: "Japan",
    generation: "Gen 0",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/tokino-sora/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2021/05/tokino_sora_thumb.png",
    sortOrder: 0
  },
  {
    id: "roboco-san",
    slug: "roboco-san",
    displayName: "Robocosan",
    branch: "Japan",
    generation: "Gen 0",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/roboco-san/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Robocosan_list_thumb.png",
    sortOrder: 1
  },
  {
    id: "aki-rosenthal",
    slug: "aki-rosenthal",
    displayName: "Aki Rosenthal",
    branch: "Japan",
    generation: "Gen 1",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/aki-rosenthal/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Aki-Rosenthal_list_thumb.png",
    sortOrder: 2
  },
  {
    id: "akai-haato",
    slug: "akai-haato",
    displayName: "Akai Haato",
    branch: "Japan",
    generation: "Gen 1",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/akai-haato/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Akai-Haato_list_thumb.png",
    sortOrder: 3
  },
  {
    id: "shirakami-fubuki",
    slug: "shirakami-fubuki",
    displayName: "Shirakami Fubuki",
    branch: "Japan",
    generation: "Gen 1 / GAMERS",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/shirakami-fubuki/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Shirakami-Fubuki_list_thumb.png",
    sortOrder: 4
  },
  {
    id: "natsuiro-matsuri",
    slug: "natsuiro-matsuri",
    displayName: "Natsuiro Matsuri",
    branch: "Japan",
    generation: "Gen 1",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/natsuiro-matsuri/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Natsuiro-Matsuri_list_thumb.png",
    sortOrder: 5
  },
  {
    id: "nakiri-ayame",
    slug: "nakiri-ayame",
    displayName: "Nakiri Ayame",
    branch: "Japan",
    generation: "Gen 2",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/nakiri-ayame/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Nakiri-Ayame_list_thumb.png",
    sortOrder: 6
  },
  {
    id: "yuzuki-choco",
    slug: "yuzuki-choco",
    displayName: "Yuzuki Choco",
    branch: "Japan",
    generation: "Gen 2",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/yuzuki-choco/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Yuzuki-Choco_list_thumb.png",
    sortOrder: 7
  },
  {
    id: "oozora-subaru",
    slug: "oozora-subaru",
    displayName: "Oozora Subaru",
    branch: "Japan",
    generation: "Gen 2",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/oozora-subaru/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Oozora-Subaru_list_thumb.png",
    sortOrder: 8
  },
  {
    id: "azki",
    slug: "azki",
    displayName: "AZKi",
    branch: "Japan",
    generation: "Gen 0",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/azki/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/AZKi_list_thumb.png",
    sortOrder: 9
  },
  {
    id: "ookami-mio",
    slug: "ookami-mio",
    displayName: "Ookami Mio",
    branch: "Japan",
    generation: "GAMERS",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/ookami-mio/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Ookami-Mio_thumb.png",
    sortOrder: 10
  },
  {
    id: "sakuramiko",
    slug: "sakuramiko",
    displayName: "Sakura Miko",
    branch: "Japan",
    generation: "Gen 0",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/sakuramiko/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Sakura-Miko_list_thumb.png",
    sortOrder: 11
  },
  {
    id: "nekomata-okayu",
    slug: "nekomata-okayu",
    displayName: "Nekomata Okayu",
    branch: "Japan",
    generation: "GAMERS",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/nekomata-okayu/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Nekomata-Okayu_list_thumb.png",
    sortOrder: 12
  },
  {
    id: "inugami-korone",
    slug: "inugami-korone",
    displayName: "Inugami Korone",
    branch: "Japan",
    generation: "GAMERS",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/inugami-korone/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Inugami-Korone_list_thumb.png",
    sortOrder: 13
  },
  {
    id: "hoshimachi-suisei",
    slug: "hoshimachi-suisei",
    displayName: "Hoshimachi Suisei",
    branch: "Japan",
    generation: "Gen 0",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/hoshimachi-suisei/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Hoshimachi-Suisei_list_thumb.png",
    sortOrder: 14
  },
  {
    id: "usada-pekora",
    slug: "usada-pekora",
    displayName: "Usada Pekora",
    branch: "Japan",
    generation: "Gen 3",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/usada-pekora/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Usada-Pekora_list_thumb.png",
    sortOrder: 15
  },
  {
    id: "shiranui-flare",
    slug: "shiranui-flare",
    displayName: "Shiranui Flare",
    branch: "Japan",
    generation: "Gen 3",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/shiranui-flare/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Shiranui-Flare_list_thumb.png",
    sortOrder: 16
  },
  {
    id: "shirogane-noel",
    slug: "shirogane-noel",
    displayName: "Shirogane Noel",
    branch: "Japan",
    generation: "Gen 3",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/shirogane-noel/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Shirogane-Noel_list_thumb.png",
    sortOrder: 17
  },
  {
    id: "houshou-marine",
    slug: "houshou-marine",
    displayName: "Houshou Marine",
    branch: "Japan",
    generation: "Gen 3",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/houshou-marine/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Houshou-Marine_list_thumb.png",
    sortOrder: 18
  },
  {
    id: "tsunomaki-watame",
    slug: "tsunomaki-watame",
    displayName: "Tsunomaki Watame",
    branch: "Japan",
    generation: "Gen 4",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/tsunomaki-watame/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Tsunomaki-Watame_list_thumb.png",
    sortOrder: 19
  },
  {
    id: "tokoyami-towa",
    slug: "tokoyami-towa",
    displayName: "Tokoyami Towa",
    branch: "Japan",
    generation: "Gen 4",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/tokoyami-towa/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Tokoyami-Towa_list_thumb.png",
    sortOrder: 20
  },
  {
    id: "himemori-luna",
    slug: "himemori-luna",
    displayName: "Himemori Luna",
    branch: "Japan",
    generation: "Gen 4",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/himemori-luna/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Himemori-Luna_list_thumb.png",
    sortOrder: 21
  },
  {
    id: "yukihana-lamy",
    slug: "yukihana-lamy",
    displayName: "Yukihana Lamy",
    branch: "Japan",
    generation: "Gen 5",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/yukihana-lamy/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Yukihana-Lamy_list_thumb.png",
    sortOrder: 22
  },
  {
    id: "momosuzu-nene",
    slug: "momosuzu-nene",
    displayName: "Momosuzu Nene",
    branch: "Japan",
    generation: "Gen 5",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/momosuzu-nene/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Momosuzu-Nene_list_thumb.png",
    sortOrder: 23
  },
  {
    id: "shishiro-botan",
    slug: "shishiro-botan",
    displayName: "Shishiro Botan",
    branch: "Japan",
    generation: "Gen 5",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/shishiro-botan/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Shishiro-Botan_list_thumb.png",
    sortOrder: 24
  },
  {
    id: "omaru-polka",
    slug: "omaru-polka",
    displayName: "Omaru Polka",
    branch: "Japan",
    generation: "Gen 5",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/omaru-polka/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Omaru-Polka_list_thumb.png",
    sortOrder: 25
  },
  {
    id: "la-darknesss",
    slug: "la-darknesss",
    displayName: "La+ Darknesss",
    branch: "Japan",
    generation: "holoX",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/la-darknesss/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/La-Darknesss_list_thumb.png",
    sortOrder: 26
  },
  {
    id: "takane-lui",
    slug: "takane-lui",
    displayName: "Takane Lui",
    branch: "Japan",
    generation: "holoX",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/takane-lui/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Takane-Lui_list_thumb.png",
    sortOrder: 27
  },
  {
    id: "hakui-koyori",
    slug: "hakui-koyori",
    displayName: "Hakui Koyori",
    branch: "Japan",
    generation: "holoX",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/hakui-koyori/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Hakui-Koyori_list_thumb.png",
    sortOrder: 28
  },
  {
    id: "kazama-iroha",
    slug: "kazama-iroha",
    displayName: "Kazama Iroha",
    branch: "Japan",
    generation: "holoX",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/kazama-iroha/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Kazama-Iroha_list_thumb.png",
    sortOrder: 29
  },
  {
    id: "sakamata-chloe",
    slug: "sakamata-chloe",
    displayName: "Sakamata Chloe",
    branch: "Japan",
    generation: "holoX",
    status: "affiliate",
    officialUrl: "https://hololive.hololivepro.com/en/talents/sakamata-chloe/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Sakamata-Chloe_list_thumb.png",
    sortOrder: 30
  },
  {
    id: "ayunda-risu",
    slug: "ayunda-risu",
    displayName: "Ayunda Risu",
    branch: "Indonesia",
    generation: "ID Gen 1",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/ayunda-risu/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Ayunda-Risu_list_thumb.png",
    sortOrder: 31
  },
  {
    id: "moona-hoshinova",
    slug: "moona-hoshinova",
    displayName: "Moona Hoshinova",
    branch: "Indonesia",
    generation: "ID Gen 1",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/moona-hoshinova/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Moona-Hoshinova_list_thumb.png",
    sortOrder: 32
  },
  {
    id: "airani-iofifteen",
    slug: "airani-iofifteen",
    displayName: "Airani Iofifteen",
    branch: "Indonesia",
    generation: "ID Gen 1",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/airani-iofifteen/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Airani-Iofifteen_list_thumb.png",
    sortOrder: 33
  },
  {
    id: "kureiji-ollie",
    slug: "kureiji-ollie",
    displayName: "Kureiji Ollie",
    branch: "Indonesia",
    generation: "ID Gen 2",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/kureiji-ollie/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Kureiji-Ollie_list_thumb.png",
    sortOrder: 34
  },
  {
    id: "anya-melfissa",
    slug: "anya-melfissa",
    displayName: "Anya Melfissa",
    branch: "Indonesia",
    generation: "ID Gen 2",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/anya-melfissa/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Anya-Melfissa_list_thumb.png",
    sortOrder: 35
  },
  {
    id: "pavolia-reine",
    slug: "pavolia-reine",
    displayName: "Pavolia Reine",
    branch: "Indonesia",
    generation: "ID Gen 2",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/pavolia-reine/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Pavolia-Reine_list_thumb.png",
    sortOrder: 36
  },
  {
    id: "vestia-zeta",
    slug: "vestia-zeta",
    displayName: "Vestia Zeta",
    branch: "Indonesia",
    generation: "ID Gen 3",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/vestia-zeta/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Vestia-Zeta_list_thumb.png",
    sortOrder: 37
  },
  {
    id: "kaela-kovalskia",
    slug: "kaela-kovalskia",
    displayName: "Kaela Kovalskia",
    branch: "Indonesia",
    generation: "ID Gen 3",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/kaela-kovalskia/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Kaela-Kovalskia_list_thumb.png",
    sortOrder: 38
  },
  {
    id: "kobo-kanaeru",
    slug: "kobo-kanaeru",
    displayName: "Kobo Kanaeru",
    branch: "Indonesia",
    generation: "ID Gen 3",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/kobo-kanaeru/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Kobo-Kanaeru_list_thumb.png",
    sortOrder: 39
  },
  {
    id: "mori-calliope",
    slug: "mori-calliope",
    displayName: "Mori Calliope",
    branch: "English",
    generation: "Myth",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/mori-calliope/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Mori-Calliope_list_thumb.png",
    sortOrder: 40
  },
  {
    id: "takanashi-kiara",
    slug: "takanashi-kiara",
    displayName: "Takanashi Kiara",
    branch: "English",
    generation: "Myth",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/takanashi-kiara/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Takanashi-Kiara_list_thumb.png",
    sortOrder: 41
  },
  {
    id: "ninomae-inanis",
    slug: "ninomae-inanis",
    displayName: "Ninomae Ina'nis",
    branch: "English",
    generation: "Myth",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/ninomae-inanis/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Ninomae-Inanis_list_thumb.png",
    sortOrder: 42
  },
  {
    id: "watson-amelia",
    slug: "watson-amelia",
    displayName: "Watson Amelia",
    branch: "English",
    generation: "Myth",
    status: "affiliate",
    officialUrl: "https://hololive.hololivepro.com/en/talents/watson-amelia/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Watson-Amelia_list_thumb.png",
    sortOrder: 43
  },
  {
    id: "irys",
    slug: "irys",
    displayName: "IRyS",
    branch: "English",
    generation: "Promise",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/irys/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/IRyS_list_thumb.png",
    sortOrder: 44
  },
  {
    id: "ouro-kronii",
    slug: "ouro-kronii",
    displayName: "Ouro Kronii",
    branch: "English",
    generation: "Promise",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/ouro-kronii/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Ouro-Kronii_list_thumb.png",
    sortOrder: 45
  },
  {
    id: "hakos-baelz",
    slug: "hakos-baelz",
    displayName: "Hakos Baelz",
    branch: "English",
    generation: "Promise",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/hakos-baelz/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Hakos-Baelz_list_thumb.png",
    sortOrder: 46
  },
  {
    id: "shiori-novella",
    slug: "shiori-novella",
    displayName: "Shiori Novella",
    branch: "English",
    generation: "Advent",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/shiori-novella/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2021/07/Shiori-Novella_list_thumb.png",
    sortOrder: 47
  },
  {
    id: "koseki-bijou",
    slug: "koseki-bijou",
    displayName: "Koseki Bijou",
    branch: "English",
    generation: "Advent",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/koseki-bijou/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2021/07/Koseki-Bijou_list_thumb.png",
    sortOrder: 48
  },
  {
    id: "nerissa-ravencroft",
    slug: "nerissa-ravencroft",
    displayName: "Nerissa Ravencroft",
    branch: "English",
    generation: "Advent",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/nerissa-ravencroft/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2021/07/Nerissa-Ravencroft_list_thumb.png",
    sortOrder: 49
  },
  {
    id: "fuwawa-abyssgard",
    slug: "fuwawa-abyssgard",
    displayName: "Fuwawa Abyssgard",
    branch: "English",
    generation: "Advent",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/fuwawa-abyssgard/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2021/07/Fuwawa-Abyssgard_list_thumb.png",
    sortOrder: 50
  },
  {
    id: "mococo-abyssgard",
    slug: "mococo-abyssgard",
    displayName: "Mococo Abyssgard",
    branch: "English",
    generation: "Advent",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/mococo-abyssgard/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2021/07/Mococo-Abyssgard_list_thumb.png",
    sortOrder: 51
  },
  {
    id: "elizabeth-rose-bloodflame",
    slug: "elizabeth-rose-bloodflame",
    displayName: "Elizabeth Rose Bloodflame",
    branch: "English",
    generation: "Justice",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/elizabeth-rose-bloodflame/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/07/Elizabeth-Rose-Bloodflame_list_thumb.png",
    sortOrder: 52
  },
  {
    id: "gigi-murin",
    slug: "gigi-murin",
    displayName: "Gigi Murin",
    branch: "English",
    generation: "Justice",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/gigi-murin/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/07/Gigi-Murin_list_thumb.png",
    sortOrder: 53
  },
  {
    id: "cecilia-immergreen",
    slug: "cecilia-immergreen",
    displayName: "Cecilia Immergreen",
    branch: "English",
    generation: "Justice",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/cecilia-immergreen/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/07/Cecilia-Immergreen_list_thumb.png",
    sortOrder: 54
  },
  {
    id: "raora-panthera",
    slug: "raora-panthera",
    displayName: "Raora Panthera",
    branch: "English",
    generation: "Justice",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/raora-panthera/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/07/Raora-Panthera_list_thumb.png",
    sortOrder: 55
  },
  {
    id: "otonose-kanade",
    slug: "otonose-kanade",
    displayName: "Otonose Kanade",
    branch: "DEV_IS",
    generation: "ReGLOSS",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/otonose-kanade/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Otonose-Kanade_list_thumb.png",
    sortOrder: 56
  },
  {
    id: "ichijou-ririka",
    slug: "ichijou-ririka",
    displayName: "Ichijou Ririka",
    branch: "DEV_IS",
    generation: "ReGLOSS",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/ichijou-ririka/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Ichijou-Ririka_list_thumb.png",
    sortOrder: 57
  },
  {
    id: "juufuutei-raden",
    slug: "juufuutei-raden",
    displayName: "Juufuutei Raden",
    branch: "DEV_IS",
    generation: "ReGLOSS",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/juufuutei-raden/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Juufuutei-Raden_list_thumb.png",
    sortOrder: 58
  },
  {
    id: "todoroki-hajime",
    slug: "todoroki-hajime",
    displayName: "Todoroki Hajime",
    branch: "DEV_IS",
    generation: "ReGLOSS",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/todoroki-hajime/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Todoroki-Hajime_list_thumb.png",
    sortOrder: 59
  },
  {
    id: "isaki-riona",
    slug: "isaki-riona",
    displayName: "Isaki Riona",
    branch: "DEV_IS",
    generation: "FLOW GLOW",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/isaki-riona/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Isaki-Riona_list_thumb.png",
    sortOrder: 60
  },
  {
    id: "koganei-niko",
    slug: "koganei-niko",
    displayName: "Koganei Niko",
    branch: "DEV_IS",
    generation: "FLOW GLOW",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/koganei-niko/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Koganei-Niko_list_thumb.png",
    sortOrder: 61
  },
  {
    id: "mizumiya-su",
    slug: "mizumiya-su",
    displayName: "Mizumiya Su",
    branch: "DEV_IS",
    generation: "FLOW GLOW",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/mizumiya-su/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Mizumiya-Su_list_thumb.png",
    sortOrder: 62
  },
  {
    id: "rindo-chihaya",
    slug: "rindo-chihaya",
    displayName: "Rindo Chihaya",
    branch: "DEV_IS",
    generation: "FLOW GLOW",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/rindo-chihaya/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Rindo-Chihaya_list_thumb.png",
    sortOrder: 63
  },
  {
    id: "kikirara-vivi",
    slug: "kikirara-vivi",
    displayName: "Kikirara Vivi",
    branch: "DEV_IS",
    generation: "FLOW GLOW",
    status: "active",
    officialUrl: "https://hololive.hololivepro.com/en/talents/kikirara-vivi/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Kikirara-Vivi_list_thumb.png",
    sortOrder: 64
  },
  {
    id: "minato-aqua",
    slug: "minato-aqua",
    displayName: "Minato Aqua",
    branch: "Japan",
    generation: "Gen 2",
    status: "alum",
    officialUrl: "https://hololive.hololivepro.com/en/talents/minato-aqua/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Minato-Aqua_list_thumb.png",
    sortOrder: 65
  },
  {
    id: "murasaki-shion",
    slug: "murasaki-shion",
    displayName: "Murasaki Shion",
    branch: "Japan",
    generation: "Gen 2",
    status: "alum",
    officialUrl: "https://hololive.hololivepro.com/en/talents/murasaki-shion/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Murasaki-Shion_list_thumb.png",
    sortOrder: 66
  },
  {
    id: "amane-kanata",
    slug: "amane-kanata",
    displayName: "Amane Kanata",
    branch: "Japan",
    generation: "Gen 4",
    status: "alum",
    officialUrl: "https://hololive.hololivepro.com/en/talents/amane-kanata/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/06/Amane-Kanata_list_thumb.png",
    sortOrder: 67
  },
  {
    id: "kiryu-coco",
    slug: "kiryu-coco",
    displayName: "Kiryu Coco",
    branch: "Japan",
    generation: "Gen 4",
    status: "alum",
    officialUrl: "https://hololive.hololivepro.com/en/talents/kiryu-coco/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Kiryu-Coco_list_thumb.png",
    sortOrder: 68
  },
  {
    id: "gawr-gura",
    slug: "gawr-gura",
    displayName: "Gawr Gura",
    branch: "English",
    generation: "Myth",
    status: "alum",
    officialUrl: "https://hololive.hololivepro.com/en/talents/gawr-gura/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Gawr-Gura_list_thumb.png",
    sortOrder: 69
  },
  {
    id: "tsukumo-sana",
    slug: "tsukumo-sana",
    displayName: "Tsukumo Sana",
    branch: "English",
    generation: "Council",
    status: "alum",
    officialUrl: "https://hololive.hololivepro.com/en/talents/tsukumo-sana/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Tsukumo-Sana_list_thumb.png",
    sortOrder: 70
  },
  {
    id: "ceres-fauna",
    slug: "ceres-fauna",
    displayName: "Ceres Fauna",
    branch: "English",
    generation: "Promise",
    status: "alum",
    officialUrl: "https://hololive.hololivepro.com/en/talents/ceres-fauna/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Ceres-Fauna_list_thumb.png",
    sortOrder: 71
  },
  {
    id: "nanashi-mumei",
    slug: "nanashi-mumei",
    displayName: "Nanashi Mumei",
    branch: "English",
    generation: "Promise",
    status: "alum",
    officialUrl: "https://hololive.hololivepro.com/en/talents/nanashi-mumei/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Nanashi-Mumei_list_thumb.png",
    sortOrder: 72
  },
  {
    id: "hiodoshi-ao",
    slug: "hiodoshi-ao",
    displayName: "Hiodoshi Ao",
    branch: "DEV_IS",
    generation: "ReGLOSS",
    status: "alum",
    officialUrl: "https://hololive.hololivepro.com/en/talents/hiodoshi-ao/",
    iconUrl: "https://hololive.hololivepro.com/wp-content/uploads/2023/09/Hiodoshi-Ao_list_thumb.png",
    sortOrder: 73
  }
];

const YOUTUBE_CHANNEL_ID_OVERRIDES: Record<string, string> = {
  "otonose-kanade": "UCWQtYtq9EOB4-I5P-3fh8lA",
  "ichijou-ririka": "UCtyWhCj3AqKh2dXctLkDtng",
  "juufuutei-raden": "UCdXAk5MpyLD8594lm_OvtGQ",
  "todoroki-hajime": "UC1iA6_NT4mtAcIII6ygrvCw"
};

function normalizeYoutubeChannelUrl(url: string | null | undefined): string | null | undefined {
  if (!url) {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\?sub_confirmation=1$/, "");
  }
}

function getYoutubeChannelId(idolId: string, url: string | null | undefined): string | null {
  const override = YOUTUBE_CHANNEL_ID_OVERRIDES[idolId];
  if (override) {
    return override;
  }

  const match = url?.match(/\/channel\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export const HOLOLIVE_IDOLS: HololiveIdol[] = HOLOLIVE_IDOL_ROSTER.map((idol) => {
  const merged = {
    ...idol,
    ...HOLOLIVE_IDOL_PROFILE_OVERRIDES[idol.id]
  };
  const youtubeChannelUrl = normalizeYoutubeChannelUrl(merged.youtubeChannelUrl);

  return {
    ...merged,
    source: "official",
    youtubeChannelUrl,
    youtubeChannelId: getYoutubeChannelId(merged.id, youtubeChannelUrl)
  };
});
