/**
 * Hand-written pool of NPC nicknames in the style of Russian online games
 * (owner request 09.11.2026): Latin and Cyrillic, leetspeak, digits, xX_..._Xx,
 * CAPS, jokes, mild and rude swearing. No slurs against nationality, religion
 * or orientation, nothing about real people. Every entry is 3..24 characters.
 */
export const NICKNAME_POOL: readonly string[] = [
  // Cyrillic, plain and jokey
  'Нагибатор', 'НеДобрыйДед', 'ГрозаСектора', 'Бывший_Адмирал', 'ПятаяТочка', 'Лютый', 'ДядяСтёпа', 'Тапок',
  'КосмоБабка', 'ЖирныйПингвин', 'Валера_Ультра', 'ДеДушка', 'Кракен', 'Бугай', 'ТёмныйКарлик', 'Шашлык',
  'ПельменьПрайм', 'Овощ', 'Борщевик', 'ЗлойОгурец', 'СтарыйВолк', 'Колобок_Киллер', 'МамкинАдмирал', 'Гоша',
  'ЧёрныйБарсук', 'ТихийУжас', 'ВсегдаПрав', 'НеПодходи', 'Дровосек', 'Сантехник', 'Карась', 'Батя',
  'БатяВСети', 'ДедИнсайд', 'КапитанОчевидность', 'Тормоз', 'Ушлёпок', 'ХмурыйКот', 'ЛысыйБес', 'Танкист_Вася',
  'ГлавныйПоЛуне', 'Мужик', 'Дембель', 'Кабанчик', 'РусскийМедведь', 'Беспредел', 'Лапоть', 'ВечнаяМерзлота',
  'ПивнойКорсар', 'Шаурмист', 'ЗапойныйПилот', 'НочнойДозор', 'СивыйМерин', 'Хомяк_Убийца', 'Гопник', 'Алкоштурман',
  'ТрезвыйШтурман', 'БешеныйТапок', 'УральскийДед', 'Сибиряк', 'ЖёсткийЗамес', 'ПростоПетя', 'КолхозКосмос', 'ЗлаяБабка',
  'ПапаКарло', 'Кровосос', 'Мясник', 'Бульдозер', 'Вонючка', 'ГлазастыйОрёл', 'Фишка', 'ДядяФёдор',
  'ЛунныйЛомовой', 'Шнырь', 'Зубр', 'Стрелочник', 'Рыбак', 'КосмоДед', 'ОпасныйДядя', 'Пельмешек',
  'ТётяЗоя', 'Кощей', 'Леший', 'ЧёртИзКоробки', 'БабаЯга', 'Упырь', 'Бармалей', 'ЧёртовЯщик',
  'КуркуляторПро', 'Дрищ', 'Тяжеловес', 'Жмых', 'Сухарик', 'Вермишель', 'ГрозныйСосед', 'ОгурецПро',
  'КартошкаГод', 'Дубина', 'Бродяга', 'ВасяПупкин', 'Чебурашка_Зло', 'Крокодил_Гена', 'ЗлойКапитан', 'ПьяныйМастер',
  // Cyrillic with swearing (mild and rude)
  'Пипец', 'ПипецВам', 'Хренозавр', 'ХренСГоры', 'Отвали', 'ОтвалиОтМеня', 'НуТыИдиот', 'Мудозвон',
  'ЗлойГондон', 'Охренеть', 'Обалдуй', 'ЗабейНаВсё', 'ДаЛадноБлин', 'Блинчик', 'БлинКомом', 'ЁпрстЁпрст',
  'ЕбаныйДед', 'Пиздюк', 'ПиздецПодкрался', 'Охуевший', 'НахерИдите', 'ПошёлТыНа', 'Дерьмо_Лорд', 'ДерьмоВоин',
  'Говнюк', 'ГовноЛорд', 'Жопорез', 'ЖопаСУшами', 'Сукин_Кот', 'СукаБлин', 'Падла', 'ЗлобныйПадла',
  'Козлина', 'Козёл_Горный', 'Тупица', 'Дебилоид', 'Ублюдок_Про', 'ЧмоШник', 'Чмырь', 'Кретин_Хмурый',
  'ХулиГан', 'Хулиган_777', 'ТыКтоТакой', 'Шлёпа', 'БарабанПиздец', 'ЕхалГрека', 'Нахал', 'Наглец',
  'Скотина', 'Тварь_Космоса', 'Паскуда', 'ЖестокийБлин', 'ЗапилилиВсех', 'НуИНахрен', 'Бздун', 'Пердун',
  'ПердунСтарый', 'Засранец', 'ЗасранецПро', 'Хмырь', 'Хрыч', 'Зараза', 'ЗлаяЗараза', 'Чёрт_Побери',
  // Latin transliteration and leetspeak
  'Nagibator', 'Nagibator228', 'NaGiBaTor_Pro', 'Zlobnyi', 'ZloyDed', 'Lyutyi', 'Batya', 'BatyaVSeti',
  'KosmoBabka', 'DedInside', 'DedInside007', 'Kapitan_Ochevid', 'Tormoz', 'Uzhas', 'TihiyUzhas', 'Mamkin_Admiral',
  'Pelmen', 'Pelmen_Prime', 'Borshevik', 'ZloyOgurec', 'Kolobok', 'Kolobok_Killer', 'Pivnoi_Korsar', 'Shaurma_Pro',
  'Shaurmist', 'Hamster_Killa', 'Gopnik', 'Gopnik_Prime', 'Slavik', 'Sanya_Rezkii', 'Vasya_Nagib', 'Kostyan',
  'Kostyan_Ultra', 'Zhenek', 'Zhenek_Pro', 'Dimon', 'Dimon_Pro', 'Seryi_Volk', 'Ruskii_Medved', 'Kapibara_Bez',
  'Pipec', 'PipecVam', 'Hrenozavr', 'Mudozvon', 'Ohrenet', 'Pizdets', 'PizdecPodkralsya', 'NahuyIdite',
  'ZloyGondon', 'Govnyuk', 'Zhopa_Lord', 'ZhopaRez', 'Padla', 'Kozlina', 'Skotina', 'Debiloid',
  'Chmo', 'Chmyr', 'Hulligan', 'Hamlo', 'Hamlo_Pro', 'Nahal', 'Bydlo', 'Bydlo_228',
  'TankistVasya', 'Dembel', 'Dembel_2024', 'Nochnoi_Dozor', 'Sibiryak', 'Ural_Boy', 'UralskiiDed', 'Kolhoz_Kosmos',
  'Dubina', 'Brodyaga', 'Leshii', 'Koschei', 'BabaYaga', 'Upyr', 'Barmaley', 'ChertPobery',
  'Vodka_Meduza', 'Medved_Pivo', 'Boroda', 'Borodach_Pro', 'Sosed', 'ZloySosed', 'DrugVasya', 'Shnyr',
  // Leetspeak, digits, CAPS
  '4eloVek', 'Ch4mp', 'N00bKiller', 'N00b_Master', 'Pr0_Gamer', 'PR0STO_PETYA', 'D3str0yer', 'D3dushka',
  'K0smonavt', 'Br0dyaga', 'Z0mbi', 'H4ck3r', 'Sn1per_Vasya', 'Tr0ll_Lord', 'Tr0ll_228', 'R3ktum',
  'M4ster', 'Gl4dkii', 'L3gend4', 'X3nom', 'V3nom_Vasya', 'Sh4dow', 'Sh4d0w_Gopnik', 'D4rk_Lord',
  'ZLOY', 'ZLOY228', 'NAGIB', 'NAGIB_2000', 'BATYA_', 'LYUTYI_', 'TORMOZ_', 'KRAKEN', 'DED', 'DED_INSIDE',
  'PIPEC_', 'HRENOZAVR_', 'OHRENET_', 'MUDOZVON_', 'KOZLINA_', 'GOPNIK_', 'LESHII_', 'KOSCHEI_',
  'ВАЛЕРА', 'ЗЛОЙ', 'НАГИБ', 'ХАМЛО', 'БЫДЛО', 'БАТЯ_ЗЛОЙ', 'ТОРМОЗИЩЕ', 'ПИПЕЦЪ', 'КРАКЕНЫЧ', 'БАРСУК_ПРО',
  'Gosha1337', 'Vasya1337', 'Petya_1337', 'Kolyan228', 'Zhenya228', 'Dimon228', 'Sanya_228', 'Vovan_228',
  'Slavik_228', 'Tolyan_2007', 'Lyokha_1995', 'Kostya_1999', 'Misha_2003', 'Andrey_Pro_2008', 'Egor_Ultra', 'Pasha_Tank',
  'Kirill_Nagib', 'Roma_Zloy', 'Vitya_AK', 'Gena_Krokodil', 'Fedya_Kosmos', 'Stepa_Gopnik', 'Zhora_Khmuryi', 'Tema_Kapitan',
  // xX_..._Xx and decorated
  'xX_Nagibator_Xx', 'xX_ZloyDed_Xx', 'xXx_Batya_xXx', 'xX_Kraken_Xx', 'xX_PIPEC_Xx', 'xX_Lyutyi_Xx', 'xX_Gopnik_Xx', 'xX_Dembel_Xx',
  'xXx_Tormoz_xXx', 'xX_Boroda_Xx', 'xX_Upyr_Xx', 'xX_Koschei_Xx', 'xX_Medved_Xx', 'xX_Sibiryak_Xx', 'xX_Padla_Xx', 'xX_Hamlo_Xx',
  '_Zloy_', '_Batya_', '-=Nagib=-', '-=Lyutyi=-', '~Kraken~', '~Dembel~', '[Zloy]', '[Batya]',
  '=ZLOY=', '=DED=', '.:Pipec:.', '.:Padla:.', '*Gopnik*', '*Batya*', '#Nagib', '#Tormoz',
  'Xx_Дед_xX', 'xX_Нагиб_Xx', 'xX_Злой_Xx', 'xX_Батя_Xx', 'xX_Пипец_Xx', 'xX_Лютый_Xx', 'xX_Упырь_Xx', 'xX_Кощей_Xx',
  '-=Лютый=-', '~Кракен~', '[Батя]', '=ЗЛОЙ=', '.:Пипец:.', '*Гопник*', '#Нагиб', '_Тормоз_',
  // Space jokes and games
  'ШтурманПьян', 'ЛетчикНеТрезв', 'КосмоСантехник', 'КосмоГопник', 'КосмоДембель', 'КосмоПельмень', 'Космобатя', 'КосмоДед_228',
  'АдмиралПельмень', 'ГенералОгурец', 'МаршалЖмых', 'КомандорШаурма', 'КапитанПиво', 'КапитанЖмых', 'ПилотБатя', 'ПилотДед',
  'ЗвёздныйГопник', 'ЗвёздныйБатя', 'ЗвёздныйПельмень', 'Лунтик_Зло', 'Марсианин_Вася', 'ЮпитерБатя', 'СатурнДед', 'КольцаСатурна',
  'ЧёрнаяДыра', 'ЧёрнаяДыра_228', 'Квазар_Вася', 'Квазарик', 'ПульсарПро', 'Туманность', 'ТуманностьВася', 'ОртаСтарый',
  'КосмоДедушка', 'Космоёж', 'КосмоЁжик', 'ЁжикВТумане', 'Ёжик_Зло', 'ЗлойЁж', 'Бобёр_Курва', 'БобёрКосмос',
  'НеКусай', 'КусайМеня', 'НеТронь', 'НеТронь_Мою', 'ОставьМеняВпокое', 'ПозвониМаме', 'МамаЗнает', 'МамаСказала',
  'ДаЯЖеПроСтоПиво', 'ЯТутПроходил', 'ЯЛегенда', 'ЯТвойБатя', 'ЯБатяЗдесь', 'ТвойБатя', 'ТвойСосед', 'ТвойКошмар',
  'ТвойАдмирал', 'ТвойНочнойКошмар', 'НочнойКошмар', 'КошмарСектора', 'ЗлойМузыкант', 'КрутойПацан', 'ЧёткийПацан', 'ПацанСРайона',
] as const;
