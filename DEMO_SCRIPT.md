# Call Script: Internal CyberSec Practice Tracker

**Para kay:** Company President, Maroon Studios
**Presenter:** Noreen
**Haba:** mga 10–12 minutes, plus Q&A

> Basahin mo lang nang diretso ang mga linya. Ang nasa **[brackets]** ay action mo sa screen, hindi binabasa.

---

## Bago mag-call

- [ ] Naka-sign in ka na as **Superadmin** at bukas ang **Board** view, walang filters.
- [ ] May ready na tickets: isang overdue, isang paused, isang resolved, isang unassigned.
- [ ] May screenshot sa clipboard para sa paste demo.
- [ ] Nakasara ang ibang tabs at naka-off ang notifications sa laptop.
- [ ] Na-test mo na ang screen share bago mag-start.

---

## 1. Opening

Hi po, Sir/Ma'am, good morning po. Salamat po sa oras ninyo ngayon.

Ipi-present ko po ngayon yung **Internal CyberSec Practice Tracker**. Ito po yung tool na ginagamit na ng SOC at Threat Intelligence teams natin para i-manage yung daily tasks nila.

Share ko lang po ang screen ko.

**[I-share ang screen. Hintayin na makita nila.]**

Nakikita n'yo na po ba ang screen ko? Okay po.

Para po sa context, dati nakakalat yung mga tasks namin sa chats, emails, at spreadsheets. Kaya mahirap malaman agad kung sino ang may hawak ng ano, kung aling tasks ang late na, at kung nami-meet ba natin yung SLA, yung response time na pinangako natin. Dito po sa tool na ito, nasa iisang lugar na lahat, at automatic na nata-track ang SLA.

---

## 2. Sign-in at access

**[Ipakita ang sign-in page o banggitin lang.]**

Una po, sa pag-access. Lahat po ay nagsa-sign in gamit ang company Google account nila, kaya walang hiwalay na password. At yung mga nasa team roster lang po natin ang makakapasok.

Role-based din po ang access. Yung mga analysts, yung operational screens lang ang nakikita nila. Kami lang pong mga Superadmin ang puwedeng magbago ng settings o mag-backup at restore ng data. Para po protektado ang data.

---

## 3. Ang Board

**[Nasa Board view.]**

Ito po yung main screen na ginagamit ng team araw-araw. Bawat card po dito ay isang task o ticket. Yung columns naman po ang nagsasabi kung nasaan na yung ticket. New, In Progress, tapos Resolved. May Canceled at Rejected din po para sa trabahong hindi na itutuloy.

**[Ituro ang colors ng cards.]**

Mapapansin n'yo po na iba-iba ang kulay ng cards. Yan po ang priority. Bawat priority ay may sariling SLA deadline. Ang Critical po, na violet, dapat matapos within 2 hours. Ang High, red, 4 hours. Medium, orange, 8 hours. Low, yellow, 24 hours. At Informational, blue, 48 hours.

**[Ituro ang countdown timer, tapos ang overdue card.]**

Bawat ticket po ay may live countdown. Makikita n'yo po dito kung ilang oras na lang ang natitira. Pag naubos na po ang oras, automatic siyang nagiging Overdue, gaya po nitong isang ito. Kaya hindi na po kailangang i-check pa manually.

**[I-click ang At Risk filter, tapos ang assignee filter.]**

Para naman po sa team leads, puwede silang mag-filter in one click. Halimbawa po, kapag pinindot ko itong "At Risk," yung mga tickets lang na malapit nang ma-miss ang deadline ang lalabas. Puwede rin pong i-filter by analyst, para makita ang workload ng isang tao.

**[I-type sa search box.]**

At dito po sa search, mahahanap ang kahit anong ticket by ID, title, o requester.

**[I-clear ang filters.]**

---

## 4. Paggawa ng ticket

**[I-click ang Create Ticket.]**

Ipapakita ko naman po kung paano gumawa ng ticket. Sinadya po naming maikli ang form para mabilis.

**[Habang nagfi-fill up.]**

Ilalagay lang po ang title, tapos pipiliin kung SOC o Threat Intelligence ang team. Tapos ang priority. Pagpili po ng priority, automatic nang nase-set ang SLA deadline. Sunod po ang category, halimbawa Rule Development o Threat Hunt. Tapos ang client, kung Internal, QC, o NSOC. Kapag NSOC po, puwede ring piliin kung aling agency. At syempre po, kung sino ang naka-assign.

**[I-paste ang screenshot sa Details gamit ang Ctrl+V.]**

Isa pa pong feature dito, puwedeng i-paste diretso ang screenshot, at naa-attach agad. Tumatanggap din po siya ng PDF, Word, at Excel.

**[I-save ang ticket.]**

Pagka-save po, makakatanggap agad ng email yung analyst na na-assign, para alam niyang may bago siyang task. Kapag na-reassign naman po, nano-notify din yung bagong assignee.

---

## 5. Pag-work ng ticket

**[Buksan ang isang ticket.]**

Sa loob naman po ng ticket, dito nagtatrabaho ang team. Puwede po silang mag-comment at mag-mention ng teammate gamit ang @, para ma-involve agad yung kailangan.

**[Ituro ang Pause button.]**

Minsan po naghihintay kami sa client o sa ibang team. Kaya may Pause button po. Habang naka-pause, humihinto ang SLA clock, para fair po ang numbers natin at hindi kami napapa-overdue dahil sa delay na hindi namin kontrolado.

**[Ituro ang Resolve, Cancel, Reject.]**

Kapag isasara na po ang ticket, required po maglagay ng resolution notes o reason. Kaya lagi pong may record kung bakit na-close ang isang ticket.

**[I-scroll sa History.]**

At dito po sa baba ang History. Naka-record po lahat ng changes, kung sino ang nagbago at kailan. Kaya may full audit trail po tayo, na importante po para sa cybersecurity team.

Isa pa pong detalye, kapag walang assignee ang ticket, hindi pa nagsisimula ang SLA clock. Nagsisimula lang po ang oras kapag may may-ari na ng task.

---

## 6. Analytics

**[Lumipat sa Analytics view.]**

Ito naman po sa tingin ko ang pinaka-useful para sa inyo at sa leadership, ang Analytics.

**[Ituro ang metric cards.]**

Dito po sa taas makikita ang main numbers. Ilang tickets ang active, ang SLA compliance percentage, ibig sabihin po gaano kadalas natin nami-meet ang deadline, ilan ang overdue, at ang average resolution time.

**[Ituro ang Workload by Analyst at Category Breakdown. Palitan ang date range.]**

Makikita rin po dito kung paano naka-distribute ang trabaho sa team, sino ang pinakamaraming hawak, at anong klaseng trabaho ang pinaka-kumakain ng oras namin. Puwede po itong i-filter by team at by date range.

**[I-click ang Export PDF.]**

At kung kailangan po ng report, puwedeng i-export as PDF. Ready na po siya para sa management meetings o client reporting.

---

## 7. Settings at automation

**[Buksan ang Settings.]**

Last part na po. Dito po sa Settings, bilang Superadmin, nima-manage ko ang system nang hindi na kailangang gumalaw ng code. Puwede kong palitan ang SLA per priority, mag-add o mag-remove ng team members, at i-update ang lists ng categories, clients, at agencies.

**[Buksan ang System & SLA Notifications.]**

May automatic email alerts din po. Kapag nag-overdue ang isang ticket, may email agad. At may weekly digest din po na nagsa-summarize ng SLA performance ng team.

---

## 8. Closing

**[I-stop ang screen share o bumalik sa Board.]**

So yun po, Sir/Ma'am. Para i-summarize, tatlo po ang main na binibigay ng tracker sa atin. Una, visibility, nasa iisang lugar na lahat ng security work at kita kung sino ang may hawak. Pangalawa, accountability, automatic ang SLA tracking at may full history. At pangatlo, reporting, may totoong numbers na tayo sa compliance at workload na puwedeng i-export.

Ginagamit na po ito ngayon ng SOC at TI teams. Para sa next steps po, gusto ko sanang **[fill in: e.g. i-expand sa ibang teams / magdagdag ng client-facing reports]**.

Yun lang po. Maraming salamat po, Sir/Ma'am. May tanong po ba kayo?

---

## Kung may itanong (sagot na puwedeng basahin)

**"Saan naka-store ang data? Secure ba?"**
Naka-store po siya sa database sa backend natin, hindi po sa laptop ng bawat isa. Kailangan po ng company Google account para makapasok, at Superadmins lang po ang puwedeng mag-backup o mag-restore ng data.

**"Magkano ang nagastos dito?"**
In-house po namin ito ginawa, kaya wala pong license fees gaya ng Jira o ServiceNow. Hosting lang po ang running cost, na nasa **[fill in ang actual amount]** po.

**"Puwede bang gamitin ng ibang teams?"**
Opo, puwede po. Configurable po sa Settings ang teams, categories, clients, at agencies. Yung agency list po ng NSOC, naka-design na para kayanin ang 100 plus na agencies.

**"Paano kung i-pause lang para itago ang delay?"**
Naka-log po sa history ang bawat pause at resume, with time, kaya nare-review po ng leads. Plano rin po naming higpitan pa ito para Superadmins lang ang puwedeng mag-edit ng pause records.
*[Note para sa iyo: sa ngayon, puwedeng i-delete ang pause log entries, kaya sinabing "plano pang higpitan."]*

**"Sino ang gumawa nito?"**
**[Sagot mo, e.g.]** Ako po ang gumawa, with support from the team, base po sa mga kailangan ng SOC at TI analysts.
