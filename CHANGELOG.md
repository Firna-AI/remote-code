# Changelog

## [0.18.0](https://github.com/Firna-AI/conductive/compare/v0.17.0...v0.18.0) (2026-11-14)


### Features

* **files:** show the saved lists while a sandbox starts ([#364](https://github.com/Firna-AI/conductive/issues/364)) ([ed0fb94](https://github.com/Firna-AI/conductive/commit/ed0fb94946f08ffb3e538b96dc7354d6fed158f2))


### Bug Fixes

* **chat:** colour Mac commands ([#356](https://github.com/Firna-AI/conductive/issues/356)) ([a182c40](https://github.com/Firna-AI/conductive/commit/a182c40ed7a63fa1e0bb35e37215b17a1b3387a8))
* **chat:** hide +0 on turn file chips without line changes ([#362](https://github.com/Firna-AI/conductive/issues/362)) ([b56cb68](https://github.com/Firna-AI/conductive/commit/b56cb686c593f9166da66e519ea893afd5133ce6))
* **chat:** put the caret at the end of a kept draft on focus ([#357](https://github.com/Firna-AI/conductive/issues/357)) ([450a3eb](https://github.com/Firna-AI/conductive/commit/450a3eb8b35b45e8a3bd97e2a6592cc31579ced8))
* **marketing:** mark chat skill selection in progress ([#363](https://github.com/Firna-AI/conductive/issues/363)) ([b714557](https://github.com/Firna-AI/conductive/commit/b7145572b9a5f1fd879545ac33738ae7a0d911ec))
* **marketing:** reflect chat, terminal, and file startup progress ([#367](https://github.com/Firna-AI/conductive/issues/367)) ([7355693](https://github.com/Firna-AI/conductive/commit/7355693077577ba3d524b8a0aa54736ef38bd2fc))
* **marketing:** reflect larger attachment upload progress ([#372](https://github.com/Firna-AI/conductive/issues/372)) ([76172c6](https://github.com/Firna-AI/conductive/commit/76172c6d24a21ab3ebfa65a4bc437da246973461))
* **marketing:** reflect saved file lists during startup ([#370](https://github.com/Firna-AI/conductive/issues/370)) ([f5baad3](https://github.com/Firna-AI/conductive/commit/f5baad305be0886f0123ba81196aeb8625abe068))
* **marketing:** reflect session link and secret plans ([#375](https://github.com/Firna-AI/conductive/issues/375)) ([0fca3ff](https://github.com/Firna-AI/conductive/commit/0fca3ffa8b847d227ae193e075e7339e70dd4bff))
* **marketing:** reflect terminal scrollback work ([#368](https://github.com/Firna-AI/conductive/issues/368)) ([a3b4072](https://github.com/Firna-AI/conductive/commit/a3b40728547676ce558fad6affb514b98248644a))
* **sidebar:** use a cog for org settings ([#360](https://github.com/Firna-AI/conductive/issues/360)) ([9db90d7](https://github.com/Firna-AI/conductive/commit/9db90d7b6a8ff51a1711040513a4a78060a05d01))


### Performance Improvements

* **lifecycle:** answer a workspace create sooner ([#365](https://github.com/Firna-AI/conductive/issues/365)) ([a86b8f4](https://github.com/Firna-AI/conductive/commit/a86b8f4845e8b1246de12b007c8e543b7352bfec))

## [0.17.0](https://github.com/Firna-AI/conductive/compare/v0.16.0...v0.17.0) (2026-11-13)


### ⚠ BREAKING CHANGES

* **runner:** remove protocol version 1 ([#339](https://github.com/Firna-AI/conductive/issues/339))

### Features

* **account:** move the agents to their own Account tab ([#333](https://github.com/Firna-AI/conductive/issues/333)) ([b52b9bb](https://github.com/Firna-AI/conductive/commit/b52b9bbdd3c12d443cea452e44d40f85b59d54d6))
* **desktop:** extend the 15 minutes of Allow all on the Mac ([#326](https://github.com/Firna-AI/conductive/issues/326)) ([36c32f3](https://github.com/Firna-AI/conductive/commit/36c32f3256120260181580bab871b92a71e072f7))
* **fast-mode:** add a Fast switch to the model menu ([#349](https://github.com/Firna-AI/conductive/issues/349)) ([e81823c](https://github.com/Firna-AI/conductive/commit/e81823c5c013e485e5c5254ffc579df0917bb596))
* **files:** open files in one temporary tab ([#345](https://github.com/Firna-AI/conductive/issues/345)) ([f935c84](https://github.com/Firna-AI/conductive/commit/f935c84c4b1f404450a49a1bc0f2e2d00ffc3d73))
* **github:** show Push when only unpushed commits are left ([#341](https://github.com/Firna-AI/conductive/issues/341)) ([e44c3e6](https://github.com/Firna-AI/conductive/commit/e44c3e69138f5bdaa24a32e7e7df521ffd98822e))
* **list:** reorder sections by drag and by the section menu ([#351](https://github.com/Firna-AI/conductive/issues/351)) ([f9c0804](https://github.com/Firna-AI/conductive/commit/f9c0804659fe06094bf398c47e1bb3bbd12b0c62))
* **mac:** move This Mac to its own tab and cut long commands short ([#337](https://github.com/Firna-AI/conductive/issues/337)) ([787a9a8](https://github.com/Firna-AI/conductive/commit/787a9a87999f44f814804acb82e0ddeddfdc980f))
* **marketing:** remove the pricing page and the billing plans ([#343](https://github.com/Firna-AI/conductive/issues/343)) ([c194159](https://github.com/Firna-AI/conductive/commit/c194159bf1b4410f74d3a37f1bf6b0b04e1a8c0d))
* **models:** offer Max and Ultra on Codex, Ultra and Extra high on Claude ([#344](https://github.com/Firna-AI/conductive/issues/344)) ([0692f4e](https://github.com/Firna-AI/conductive/commit/0692f4ef25bc16ebef04d055ac3a2a8be00f92bf))
* **orgs:** open the last workspace of each org ([#353](https://github.com/Firna-AI/conductive/issues/353)) ([4fb7633](https://github.com/Firna-AI/conductive/commit/4fb76331fdc4e2722d814f722767f7baf8af3714))
* **tabs:** keep the reader's place in each tab ([#350](https://github.com/Firna-AI/conductive/issues/350)) ([974690b](https://github.com/Firna-AI/conductive/commit/974690bf00719dbc018c0357fe854f874b4fe188))


### Bug Fixes

* **marketing:** reflect shipped tab and section controls ([#355](https://github.com/Firna-AI/conductive/issues/355)) ([e20d431](https://github.com/Firna-AI/conductive/commit/e20d431a352962063e3a3e9bc1348f4b13aa0f30))
* **marketing:** refresh Conductor feature progress ([#352](https://github.com/Firna-AI/conductive/issues/352)) ([6fed65e](https://github.com/Firna-AI/conductive/commit/6fed65e6f38c5e1b88f7c2e0cc32fa5f61d977d3))
* **shell:** show the rail org name on hover, not after a click ([#346](https://github.com/Firna-AI/conductive/issues/346)) ([ce9313b](https://github.com/Firna-AI/conductive/commit/ce9313bba01ce3ae9723d391566a6c55a82f7eb3))


### Code Refactoring

* **runner:** remove protocol version 1 ([#339](https://github.com/Firna-AI/conductive/issues/339)) ([b409ef7](https://github.com/Firna-AI/conductive/commit/b409ef7f2a63de3065ed756e66871a3a3491aa85))

## [0.16.0](https://github.com/Firna-AI/conductive/compare/v0.15.0...v0.16.0) (2026-11-13)


### Features

* **attachments:** raise the file limit to 100 MB ([#323](https://github.com/Firna-AI/conductive/issues/323)) ([e49fd5e](https://github.com/Firna-AI/conductive/commit/e49fd5e2e7c90484f2e0d06a3eeb3afe1fe6f629))
* **chat:** add a Copy code button to code blocks ([#309](https://github.com/Firna-AI/conductive/issues/309)) ([246e2d7](https://github.com/Firna-AI/conductive/commit/246e2d787025de390f0de633801a60172e00cfd2))
* **chat:** attach a dropped folder as a zip ([#324](https://github.com/Firna-AI/conductive/issues/324)) ([0d943b6](https://github.com/Firna-AI/conductive/commit/0d943b69cfaf52f15c164dc4711fe022543916c9))
* **chat:** keep the other agent in a session with no message ([#295](https://github.com/Firna-AI/conductive/issues/295)) ([979d760](https://github.com/Firna-AI/conductive/commit/979d7603480398320bdbe2e98087cb16a29eb60d))
* **chat:** limit the files at the end of a turn ([#331](https://github.com/Firna-AI/conductive/issues/331)) ([4a5702e](https://github.com/Firna-AI/conductive/commit/4a5702ea3450db4d98a3d32c739e252dcc24edde))
* **chat:** take a file drop anywhere on the chat column ([#332](https://github.com/Firna-AI/conductive/issues/332)) ([094beb9](https://github.com/Firna-AI/conductive/commit/094beb99e26a39cfa4810b44fc125243c4f39b4f))
* **list:** rename a workspace with a double click on its sidebar row ([#321](https://github.com/Firna-AI/conductive/issues/321)) ([403db36](https://github.com/Firna-AI/conductive/commit/403db364f2e353ee25efdce7f517a5c4b09757c8))
* **mac:** allow all Mac commands until Stop ([#325](https://github.com/Firna-AI/conductive/issues/325)) ([87dbb94](https://github.com/Firna-AI/conductive/commit/87dbb9469697e4513d2d7bcafa607070c0e57f22))
* **new-workspace:** open New workspace as the dialog for new accounts ([#330](https://github.com/Firna-AI/conductive/issues/330)) ([d800916](https://github.com/Firna-AI/conductive/commit/d800916aa3e14c631c1e43d6ebc4e135baf8296c))
* **new-workspace:** pick the section in the New workspace dialog ([#315](https://github.com/Firna-AI/conductive/issues/315)) ([dd0841c](https://github.com/Firna-AI/conductive/commit/dd0841c7812571be842c722f232de2b0faca25a1))
* **orgs:** let each person reorder the orgs in the rail ([#293](https://github.com/Firna-AI/conductive/issues/293)) ([731b107](https://github.com/Firna-AI/conductive/commit/731b1077b4955173de97b47b76b2d8287b4b3348))
* **previews:** show the Worker's step times in Server-Timing ([#301](https://github.com/Firna-AI/conductive/issues/301)) ([72b85ec](https://github.com/Firna-AI/conductive/commit/72b85ec8f03141767518aaf07cdd7cba8add6070))
* **runner:** raise the background work limit to 30 days ([#335](https://github.com/Firna-AI/conductive/issues/335)) ([de2df9f](https://github.com/Firna-AI/conductive/commit/de2df9fe05b8b9b441e2ff00def30bb2ef695746))


### Bug Fixes

* **agent-tools:** split the tool install into commands under 64 KiB ([#314](https://github.com/Firna-AI/conductive/issues/314)) ([379f606](https://github.com/Firna-AI/conductive/commit/379f60628a38f1840e2e58f70d3ad27b120e6eb3))
* **app:** draw Archive on the pull request bar as an outline button ([#322](https://github.com/Firna-AI/conductive/issues/322)) ([9d9571c](https://github.com/Firna-AI/conductive/commit/9d9571cd5d06d4cf84b1f2de2526f8567de2a8d8))
* **chat:** scroll to the bottom when the user sends a message ([#317](https://github.com/Firna-AI/conductive/issues/317)) ([0786b88](https://github.com/Firna-AI/conductive/commit/0786b8865875fa1edff515872feaedaccd411d4f))
* **github:** show the known pull request state at once ([#298](https://github.com/Firna-AI/conductive/issues/298)) ([85ca44e](https://github.com/Firna-AI/conductive/commit/85ca44e9690590e19f51253d876618d0b63f333d))
* **list:** show the pull request bar state in the list mark ([#334](https://github.com/Firna-AI/conductive/issues/334)) ([cc3ea64](https://github.com/Firna-AI/conductive/commit/cc3ea6470ca9fe25fb8f246be5643d7f522ceb6d))
* **mac:** make Stop on the 15 minutes bar an outline button ([#308](https://github.com/Firna-AI/conductive/issues/308)) ([caeaaf0](https://github.com/Firna-AI/conductive/commit/caeaaf0ed017f928c244fa68f97b0596a3a9676a))
* **marketing:** mark personal org order as available ([#306](https://github.com/Firna-AI/conductive/issues/306)) ([879ebd1](https://github.com/Firna-AI/conductive/commit/879ebd1f24b408f5ccbe3c89cb0e644e494fb4dc))
* **marketing:** mark the public changelog as in progress ([#329](https://github.com/Firna-AI/conductive/issues/329)) ([63b116a](https://github.com/Firna-AI/conductive/commit/63b116a3bda1b2d82df71416cd2fc562112d62c8))
* **marketing:** refresh comparison after recent feature work ([#328](https://github.com/Firna-AI/conductive/issues/328)) ([0eb698c](https://github.com/Firna-AI/conductive/commit/0eb698c6322797feae0404ae75737f7336e0c0f3))
* **marketing:** refresh pending comparison features ([#312](https://github.com/Firna-AI/conductive/issues/312)) ([c0b510e](https://github.com/Firna-AI/conductive/commit/c0b510e1f20aee1f9215742465bbc0470fb145b7))
* **marketing:** refresh shipped comparison features ([#336](https://github.com/Firna-AI/conductive/issues/336)) ([e46dd76](https://github.com/Firna-AI/conductive/commit/e46dd76ac653f85bddaa0b5271cc91ea6b53cfe9))
* **marketing:** track pending org order and agent switching ([#300](https://github.com/Firna-AI/conductive/issues/300)) ([8b5eee1](https://github.com/Firna-AI/conductive/commit/8b5eee17a9f5dc2c8247a8ae307710d13735d18a))
* **menus:** flip shell menus that would pass the window edge ([#316](https://github.com/Firna-AI/conductive/issues/316)) ([5b46e12](https://github.com/Firna-AI/conductive/commit/5b46e12d2bb00900633f66e135be3156c89c9c13))
* **software-image:** split the tools install under the argument limit ([#305](https://github.com/Firna-AI/conductive/issues/305)) ([0ab26e0](https://github.com/Firna-AI/conductive/commit/0ab26e0d441b0dbe770e11bf44755017fbd4d25f))
* **tools:** keep Preview mounted while another tool shows ([#320](https://github.com/Firna-AI/conductive/issues/320)) ([ae280d2](https://github.com/Firna-AI/conductive/commit/ae280d21422e2059f51b3c3c7ce36d8fcf97ee7b))


### Performance Improvements

* **image:** stop disk flushes in sandboxes ([#294](https://github.com/Firna-AI/conductive/issues/294)) ([4f9071d](https://github.com/Firna-AI/conductive/commit/4f9071df6ea15c9d224989d93018d357f70239cc))
* **previews:** check each preview viewer once a second ([#307](https://github.com/Firna-AI/conductive/issues/307)) ([b755f0b](https://github.com/Firna-AI/conductive/commit/b755f0bb54801c5156489043daa83cedf867c9bb))
* **workspace:** show an Archive at once, and undo it on failure ([#318](https://github.com/Firna-AI/conductive/issues/318)) ([3286994](https://github.com/Firna-AI/conductive/commit/3286994b6b6647a85add1b8f84fa2cf96b274e6b))

## [0.15.0](https://github.com/Firna-AI/conductive/compare/v0.14.0...v0.15.0) (2026-11-12)


### Features

* **chat:** load the newest chat history first ([#281](https://github.com/Firna-AI/conductive/issues/281)) ([f13c083](https://github.com/Firna-AI/conductive/commit/f13c083005b1bde6d6ebee12cccdf8214e38355d))
* **files:** list context folder files in All files ([#288](https://github.com/Firna-AI/conductive/issues/288)) ([ad6e2ba](https://github.com/Firna-AI/conductive/commit/ad6e2bad5352b4b1437e25c59b8dd1edb439c3da))
* **menus:** add Copy link to the workspace and session tab menus ([#292](https://github.com/Firna-AI/conductive/issues/292)) ([5bd05b4](https://github.com/Firna-AI/conductive/commit/5bd05b46c05312164ea67862b625f5286ef32196))
* **sidebar:** focus the message box after a click on a workspace ([#279](https://github.com/Firna-AI/conductive/issues/279)) ([2d0e217](https://github.com/Firna-AI/conductive/commit/2d0e2174d5687ba8c94e2dba20444621cef4b958))


### Bug Fixes

* **files:** name a file tab from its read when no list holds the file ([#289](https://github.com/Firna-AI/conductive/issues/289)) ([c710a30](https://github.com/Firna-AI/conductive/commit/c710a306c10ac331e23d89d9f4efde44b71e4130))
* **marketing:** refresh merged and pending comparison features ([#296](https://github.com/Firna-AI/conductive/issues/296)) ([82951d4](https://github.com/Firna-AI/conductive/commit/82951d42cc6c66cc8d6c017fb10f7a4a9876e30f))
* **workspace:** show Starting, not a Resume bar, while an open resumes ([#290](https://github.com/Firna-AI/conductive/issues/290)) ([8c49081](https://github.com/Firna-AI/conductive/commit/8c49081e304c1070a6e2e09a89c49e3a7e93cc97))


### Performance Improvements

* **chat:** show a sent message at once and clear the composer ([#285](https://github.com/Firna-AI/conductive/issues/285)) ([9457304](https://github.com/Firna-AI/conductive/commit/9457304f6c5b22379a1ccf53222596476cd2b925))

## [0.14.0](https://github.com/Firna-AI/conductive/compare/v0.13.0...v0.14.0) (2026-11-12)


### Features

* add own endpoint logins for Claude and Codex ([#263](https://github.com/Firna-AI/conductive/issues/263)) ([579ad69](https://github.com/Firna-AI/conductive/commit/579ad69850e002bbd4810f38f7ffa8cad86b7f2e))
* **files:** show syntax colours in diffs ([#276](https://github.com/Firna-AI/conductive/issues/276)) ([9b0bbcb](https://github.com/Firna-AI/conductive/commit/9b0bbcbb2f86d588940839d939e5d24032ef9acd))
* **model-gateway:** route ChatGPT through a Cloudflare Container ([#287](https://github.com/Firna-AI/conductive/issues/287)) ([1f1b54a](https://github.com/Firna-AI/conductive/commit/1f1b54aa4f97a524bb091db4cae2f721cff58121))
* **terminal:** plan terminal tabs and draw their mockups ([#280](https://github.com/Firna-AI/conductive/issues/280)) ([b1874ca](https://github.com/Firna-AI/conductive/commit/b1874ca947ae5d85671b7afda771ce4c81f24a74))
* **workspace:** resize the split between the files and the tools ([#283](https://github.com/Firna-AI/conductive/issues/283)) ([ade62e3](https://github.com/Firna-AI/conductive/commit/ade62e35e2abcde25199790116c47467f370df79))


### Bug Fixes

* **account:** follow background model list reads in an open tab ([579ad69](https://github.com/Firna-AI/conductive/commit/579ad69850e002bbd4810f38f7ffa8cad86b7f2e))
* **account:** keep the model list in the reply of a share change ([579ad69](https://github.com/Firna-AI/conductive/commit/579ad69850e002bbd4810f38f7ffa8cad86b7f2e))
* **chat:** name the model of the failed Codex message ([579ad69](https://github.com/Firna-AI/conductive/commit/579ad69850e002bbd4810f38f7ffa8cad86b7f2e))
* **marketing:** refresh Conductor comparison notes ([#282](https://github.com/Firna-AI/conductive/issues/282)) ([cc472bb](https://github.com/Firna-AI/conductive/commit/cc472bb002d3182e3bd6bffeb84fbd777596941b))
* **marketing:** track vertical panel resizing in progress ([#286](https://github.com/Firna-AI/conductive/issues/286)) ([1c66e33](https://github.com/Firna-AI/conductive/commit/1c66e330f852c6f72d60463e7a15d124b5d212c5))
* **model-gateway:** keep ordinary request paths in endpoint answers ([579ad69](https://github.com/Firna-AI/conductive/commit/579ad69850e002bbd4810f38f7ffa8cad86b7f2e))
* **ui:** make menu hover visible and show the pointer cursor ([#278](https://github.com/Firna-AI/conductive/issues/278)) ([8057cac](https://github.com/Firna-AI/conductive/commit/8057cacd3bd0cfddb2002ecbe8939f24bd633f70))

## [0.13.0](https://github.com/Firna-AI/conductive/compare/v0.12.0...v0.13.0) (2026-11-12)


### Features

* **agent-tools:** manage workspaces, sessions, sections, and previews ([#267](https://github.com/Firna-AI/conductive/issues/267)) ([b8ed3c8](https://github.com/Firna-AI/conductive/commit/b8ed3c8f69e7ab69e8324860e48287812d9432ea))
* **list:** run the mark light while checks run ([#277](https://github.com/Firna-AI/conductive/issues/277)) ([d789f9e](https://github.com/Firna-AI/conductive/commit/d789f9e904dfb4a74497f473c665cd3baed43e17))
* **previews:** put Close on each preview tab ([#255](https://github.com/Firna-AI/conductive/issues/255)) ([10da61a](https://github.com/Firna-AI/conductive/commit/10da61afdb00e9e32b374c86a2db342ac7e436e7))


### Bug Fixes

* **list:** brighten the working light of the workspace mark ([#274](https://github.com/Firna-AI/conductive/issues/274)) ([e778799](https://github.com/Firna-AI/conductive/commit/e778799c7a77d2041e28088deb584cc4da029775))
* **list:** keep the Archived group as it was after an Archive ([#271](https://github.com/Firna-AI/conductive/issues/271)) ([b504e8b](https://github.com/Firna-AI/conductive/commit/b504e8b8ab8a9d5e700c9a2aad99104434975166))

## [0.12.0](https://github.com/Firna-AI/conductive/compare/v0.11.0...v0.12.0) (2026-11-11)


### Features

* **chat:** drop files into the composer as chips in the text ([#266](https://github.com/Firna-AI/conductive/issues/266)) ([ece84da](https://github.com/Firna-AI/conductive/commit/ece84da697ad840368e21f0bf5e3bd80e1f8215b))


### Bug Fixes

* **mac:** close menus on a press on a top bar ([#268](https://github.com/Firna-AI/conductive/issues/268)) ([7700c8f](https://github.com/Firna-AI/conductive/commit/7700c8f6301ead7bf18c136f3186bd17875a0b31))


### Performance Improvements

* **lifecycle:** run start D1 and Boat calls outside the chat queue ([#261](https://github.com/Firna-AI/conductive/issues/261)) ([a822367](https://github.com/Firna-AI/conductive/commit/a82236777bb99ff7fecf6bd89d1d95baca4975dc))

## [0.11.0](https://github.com/Firna-AI/conductive/compare/v0.10.0...v0.11.0) (2026-11-11)


### Features

* **shortcuts:** add keyboard shortcuts and their settings tab ([#216](https://github.com/Firna-AI/conductive/issues/216)) ([0ad6a1c](https://github.com/Firna-AI/conductive/commit/0ad6a1c6f47a1de4c070cc1348869feaa8992676))

## [0.10.0](https://github.com/Firna-AI/conductive/compare/v0.9.1...v0.10.0) (2026-11-11)


### Features

* **chat:** draw Markdown headings in agent messages ([#244](https://github.com/Firna-AI/conductive/issues/244)) ([4374132](https://github.com/Firna-AI/conductive/commit/43741329ba2817835dbfec17e602895485301267))
* **workspaces:** show GitHub state in workspace marks ([#208](https://github.com/Firna-AI/conductive/issues/208)) ([eb34094](https://github.com/Firna-AI/conductive/commit/eb340941118ea2b35e4987808f186472a961ded0))


### Bug Fixes

* **ci:** keep the ChatGPT host helper private ([#262](https://github.com/Firna-AI/conductive/issues/262)) ([9125746](https://github.com/Firna-AI/conductive/commit/91257465c22f54287ee0bd6a69168350e45a964f))
* **files:** keep a lazy list line from becoming a heading underline ([4374132](https://github.com/Firna-AI/conductive/commit/43741329ba2817835dbfec17e602895485301267))
* **github:** read GitHub only for workspaces that a webhook can change ([#251](https://github.com/Firna-AI/conductive/issues/251)) ([c53e7fd](https://github.com/Firna-AI/conductive/commit/c53e7fd0ed1d53c80eb2d9352a95c349aa001423))
* **github:** skip archived workspaces when a webhook arrives ([#249](https://github.com/Firna-AI/conductive/issues/249)) ([dae46ac](https://github.com/Firna-AI/conductive/commit/dae46acdcdaf822b294001399fef9669c5ea6b93))
* **marketing:** update agent controls and changelog statuses ([#248](https://github.com/Firna-AI/conductive/issues/248)) ([f51097b](https://github.com/Firna-AI/conductive/commit/f51097b8b602d1a3cebe93e7f36b3bc0c2dd63b9))
* **model-gateway:** send chatgpt.com requests through an egress proxy ([#259](https://github.com/Firna-AI/conductive/issues/259)) ([dfd2ebf](https://github.com/Firna-AI/conductive/commit/dfd2ebf15c861b9e2f2b2ebde711e702f08fa870))
* **runner:** keep turns open for background work ([#245](https://github.com/Firna-AI/conductive/issues/245)) ([6b21ea3](https://github.com/Firna-AI/conductive/commit/6b21ea3412e045710a630fb13a16d6c0f3acc389))
* **runner:** name MCP tools in chat and let agents use the desktop ([#247](https://github.com/Firna-AI/conductive/issues/247)) ([1b2579d](https://github.com/Firna-AI/conductive/commit/1b2579df1e054e4d1b336231b45dc1d2074709b9))


### Performance Improvements

* **github:** read pull request banners in one GraphQL query ([#254](https://github.com/Firna-AI/conductive/issues/254)) ([8576421](https://github.com/Firna-AI/conductive/commit/8576421df2fbebf1a74af8cb936b273563911193))

## [0.9.1](https://github.com/Firna-AI/conductive/compare/v0.9.0...v0.9.1) (2026-11-11)


### Bug Fixes

* **marketing:** refresh chat and workspace progress ([#241](https://github.com/Firna-AI/conductive/issues/241)) ([cb67e06](https://github.com/Firna-AI/conductive/commit/cb67e0610c941177485e61eef9b0b014ebe503f0))


### Performance Improvements

* **chat:** read session history in a few large pages ([#242](https://github.com/Firna-AI/conductive/issues/242)) ([9188144](https://github.com/Firna-AI/conductive/commit/91881446b4f2ad50fe7ed68892d98228d8eb4f38))
* **chat:** show the chat while the session history loads ([#239](https://github.com/Firna-AI/conductive/issues/239)) ([2b3a3e0](https://github.com/Firna-AI/conductive/commit/2b3a3e03aedd88a518d2da521aa11051e39ac1c1))

## [0.9.0](https://github.com/Firna-AI/conductive/compare/v0.8.0...v0.9.0) (2026-11-11)


### Features

* **github:** add pull request bar actions and Continue ([#176](https://github.com/Firna-AI/conductive/issues/176)) ([d7a8a0c](https://github.com/Firna-AI/conductive/commit/d7a8a0c97d520359d813899dd7a6f506c246cdc0))
* **logins:** connect Codex to a ChatGPT plan with device sign-in ([#177](https://github.com/Firna-AI/conductive/issues/177)) ([d970f26](https://github.com/Firna-AI/conductive/commit/d970f263a4f45b2c2918324dfe3de217d6320ee7))
* **marketing:** add approved social link preview ([#228](https://github.com/Firna-AI/conductive/issues/228)) ([b5dbada](https://github.com/Firna-AI/conductive/commit/b5dbada1f924bad7703b686c40bb6ef55d57c4c1))


### Bug Fixes

* **chat:** keep only the newest run of tool calls open during a turn ([#167](https://github.com/Firna-AI/conductive/issues/167)) ([23628f7](https://github.com/Firna-AI/conductive/commit/23628f77b7f0dc8ecb8740a7242e666da53e799f))
* **github:** keep agent pushes working and explain access failures ([#235](https://github.com/Firna-AI/conductive/issues/235)) ([36c3b17](https://github.com/Firna-AI/conductive/commit/36c3b17cb9cf11c1f7d59da6971eee4e854448f4))
* **github:** show why Git got no GitHub access ([36c3b17](https://github.com/Firna-AI/conductive/commit/36c3b17cb9cf11c1f7d59da6971eee4e854448f4))
* **github:** tint merged pull requests purple ([#234](https://github.com/Firna-AI/conductive/issues/234)) ([acd22d5](https://github.com/Firna-AI/conductive/commit/acd22d551f4e60e36a7b8878e7fa01c1cb096107))
* **marketing:** mark session links available in Conductor comparison ([#227](https://github.com/Firna-AI/conductive/issues/227)) ([5759a4b](https://github.com/Firna-AI/conductive/commit/5759a4b9a5f4f442e6713cb5cefd9097a89c0004))
* **marketing:** note planned background work and manual logins ([#237](https://github.com/Firna-AI/conductive/issues/237)) ([32d09c4](https://github.com/Firna-AI/conductive/commit/32d09c4ee3507e0330bfbc2b5778ea277ab2b3d6))
* **marketing:** refresh Conductor comparison statuses ([#229](https://github.com/Firna-AI/conductive/issues/229)) ([f5eb804](https://github.com/Firna-AI/conductive/commit/f5eb804fcc2007b3348fa76d67d759363d01fb3d))
* **release:** use the renamed repository Firna-AI/conductive ([#233](https://github.com/Firna-AI/conductive/issues/233)) ([16c0aac](https://github.com/Firna-AI/conductive/commit/16c0aac8b95fe639a303d3a558c0e04645aa23e7))


### Performance Improvements

* **previews:** let the viewer's browser cache preview files ([#232](https://github.com/Firna-AI/conductive/issues/232)) ([cad6880](https://github.com/Firna-AI/conductive/commit/cad68800a023c0832a13604c06482f305c2d3ae5))

## [0.8.0](https://github.com/Firna-AI/remote-code/compare/v0.7.0...v0.8.0) (2026-11-11)


### Features

* **agent-tools:** manage sessions across workspaces ([#215](https://github.com/Firna-AI/remote-code/issues/215)) ([80401a0](https://github.com/Firna-AI/remote-code/commit/80401a0656c7be96cd863563d5efdc3347d44fbd))
* **chat:** mark models that open a new session with an icon ([#203](https://github.com/Firna-AI/remote-code/issues/203)) ([def319a](https://github.com/Firna-AI/remote-code/commit/def319a5d59e2656035332c3ee3a4786217f5187))
* **feedback:** send feedback from the command palette ([#201](https://github.com/Firna-AI/remote-code/issues/201)) ([1da13cc](https://github.com/Firna-AI/remote-code/commit/1da13cc149ede213e4a7c4c9c69233b04936841e))
* **new-workspace:** add Cloud computer settings to the build notice ([#189](https://github.com/Firna-AI/remote-code/issues/189)) ([8f3d52a](https://github.com/Firna-AI/remote-code/commit/8f3d52aad40a329bb162110a0a97fcfd73b09930))
* **waitlist:** add a global waitlist switch ([#135](https://github.com/Firna-AI/remote-code/issues/135)) ([067e82b](https://github.com/Firna-AI/remote-code/commit/067e82b63d79a9fd945357a311e19275caf42cd1))


### Bug Fixes

* **marketing:** mark agent session reads and GitHub list marks in progress ([#206](https://github.com/Firna-AI/remote-code/issues/206)) ([ce5ca2d](https://github.com/Firna-AI/remote-code/commit/ce5ca2d1384d457196a9c6720c51dda91068efc5))
* **marketing:** mark file drops and image tab previews in progress ([#221](https://github.com/Firna-AI/remote-code/issues/221)) ([31d7b33](https://github.com/Firna-AI/remote-code/commit/31d7b3300c505983b7a1d8baad2785c6fe1f3035))
* **marketing:** note routine sections and older workspace updates ([#225](https://github.com/Firna-AI/remote-code/issues/225)) ([d1dc058](https://github.com/Firna-AI/remote-code/commit/d1dc058d877afa4f61d76aca9fd1aabf42a3d06d))
* **marketing:** reflect approved work in Conductor comparison ([#212](https://github.com/Firna-AI/remote-code/issues/212)) ([c135170](https://github.com/Firna-AI/remote-code/commit/c13517063d4ee89ab156798946ead424044c036f))
* **marketing:** reflect planned file drops and Codex ChatGPT sign-in ([#202](https://github.com/Firna-AI/remote-code/issues/202)) ([03ea2ce](https://github.com/Firna-AI/remote-code/commit/03ea2ce5497229aece8fbd53ac588371a1e455be))
* **marketing:** refresh comparison from recent workspace activity ([#198](https://github.com/Firna-AI/remote-code/issues/198)) ([e5aea6c](https://github.com/Firna-AI/remote-code/commit/e5aea6c749fa6277dd02abac3bd8375a1b3fbf7a))
* **marketing:** refresh planned features in Conductor comparison ([#205](https://github.com/Firna-AI/remote-code/issues/205)) ([5dd38af](https://github.com/Firna-AI/remote-code/commit/5dd38af5f515972eeafdcdfcbdab6bbc248b163b))
* **marketing:** update session link and heading statuses ([#219](https://github.com/Firna-AI/remote-code/issues/219)) ([81fa409](https://github.com/Firna-AI/remote-code/commit/81fa4094f112ff9282ca334a2938d36f15c46e03))
* **runner:** watch the live repository after the disk restore ends ([#226](https://github.com/Firna-AI/remote-code/issues/226)) ([84bdcb2](https://github.com/Firna-AI/remote-code/commit/84bdcb29ec613d430328e0a8d4aa5e5aea4ce2a1))
* **titles:** replace underscores in model workspace names ([#197](https://github.com/Firna-AI/remote-code/issues/197)) ([f874827](https://github.com/Firna-AI/remote-code/commit/f8748270919b3d0f9db8f5db35e23fad2ea0033d))


### Performance Improvements

* **previews:** check preview bodies in larger reads ([#210](https://github.com/Firna-AI/remote-code/issues/210)) ([94f5781](https://github.com/Firna-AI/remote-code/commit/94f578126efb654e26e01da9479b35cdd7ab993e))

## [0.7.0](https://github.com/Firna-AI/remote-code/compare/v0.6.0...v0.7.0) (2026-11-10)


### Features

* **routines:** name the refused login in its own error field ([d39e64e](https://github.com/Firna-AI/remote-code/commit/d39e64eb1ee3949f4ddd905f890adce3a544169a))
* **routines:** start agent runs on schedules and pull request events ([#182](https://github.com/Firna-AI/remote-code/issues/182)) ([d39e64e](https://github.com/Firna-AI/remote-code/commit/d39e64eb1ee3949f4ddd905f890adce3a544169a))


### Bug Fixes

* **app:** restore the New workspace row styles ([d39e64e](https://github.com/Firna-AI/remote-code/commit/d39e64eb1ee3949f4ddd905f890adce3a544169a))
* **marketing:** mark routines as available on the comparison page ([d39e64e](https://github.com/Firna-AI/remote-code/commit/d39e64eb1ee3949f4ddd905f890adce3a544169a))
* **marketing:** reflect planned chat links and import progress ([#195](https://github.com/Firna-AI/remote-code/issues/195)) ([b0fecbe](https://github.com/Firna-AI/remote-code/commit/b0fecbe5507501a4db15e53f7eadbba7eb62bf61))


### Performance Improvements

* **workspaces:** hibernate idle workspace connections ([#148](https://github.com/Firna-AI/remote-code/issues/148)) ([247c772](https://github.com/Firna-AI/remote-code/commit/247c772afaf09cae29856f67dc4ada41b646cb20))

## [0.6.0](https://github.com/Firna-AI/remote-code/compare/v0.5.0...v0.6.0) (2026-11-10)


### Features

* build added repositories and show what waits for a build ([#188](https://github.com/Firna-AI/remote-code/issues/188)) ([b25d8e0](https://github.com/Firna-AI/remote-code/commit/b25d8e0d3021d6235b827c49ad0c04bb933b8655))
* **chat:** copy session transcripts as Markdown ([#164](https://github.com/Firna-AI/remote-code/issues/164)) ([5d56546](https://github.com/Firna-AI/remote-code/commit/5d56546ceba68d6e19c3a673df1e18460f0164dc))
* **chat:** nest lists and keep list numbers in agent answers ([#161](https://github.com/Firna-AI/remote-code/issues/161)) ([39b0941](https://github.com/Firna-AI/remote-code/commit/39b09416c13d1c038bd0b4876424608f70abea07))
* **marketing:** add check time, row links, and local Conductor rows ([#175](https://github.com/Firna-AI/remote-code/issues/175)) ([08cbe3c](https://github.com/Firna-AI/remote-code/commit/08cbe3cd07ce4e3b0394e499d909a43f6add4c47))
* **marketing:** add the public pricing page ([#170](https://github.com/Firna-AI/remote-code/issues/170)) ([871adca](https://github.com/Firna-AI/remote-code/commit/871adcac0952309a34647793582540ea37f68387))
* **previews:** detect running servers in Preview ([#154](https://github.com/Firna-AI/remote-code/issues/154)) ([27f888f](https://github.com/Firna-AI/remote-code/commit/27f888f4a600ffa399f26c54bf269b220b06ecf3))
* **previews:** label the new tab link of a preview "Open" ([#191](https://github.com/Firna-AI/remote-code/issues/191)) ([2008305](https://github.com/Firna-AI/remote-code/commit/20083050b2f427b4ddd30df9aa6843525bb8edd0))
* **software-image:** start first builds from a shared image ([#180](https://github.com/Firna-AI/remote-code/issues/180)) ([4249b33](https://github.com/Firna-AI/remote-code/commit/4249b33de2b026b08415e3a02b686981daf820b6))
* **worker:** turn on Cloudflare Issues error tracking ([#178](https://github.com/Firna-AI/remote-code/issues/178)) ([c47330b](https://github.com/Firna-AI/remote-code/commit/c47330bded028cc6f8f59572f04bd359bef641fc))
* **workspaces:** archive at once and restore within 14 days ([#138](https://github.com/Firna-AI/remote-code/issues/138)) ([8eaf4b2](https://github.com/Firna-AI/remote-code/commit/8eaf4b21e3e788f82b13b3f794142e7753f99b43))
* **workspaces:** keep attachments and notes in .context ([#168](https://github.com/Firna-AI/remote-code/issues/168)) ([6fd184c](https://github.com/Firna-AI/remote-code/commit/6fd184c53e77dee208687512244ebcaf5fa120e9))


### Bug Fixes

* **chat:** remove the label under queued messages ([#165](https://github.com/Firna-AI/remote-code/issues/165)) ([1e6e28b](https://github.com/Firna-AI/remote-code/commit/1e6e28b7912bbcf22ff1e096d0c1d9bbd89af87e))
* **files:** wait for the sandbox, and start it when a file opens ([#171](https://github.com/Firna-AI/remote-code/issues/171)) ([46769d9](https://github.com/Firna-AI/remote-code/commit/46769d979ff1151cf9cfaf02a4e4de0e9e582057))
* **github:** return to the screen where a GitHub App change started ([#169](https://github.com/Firna-AI/remote-code/issues/169)) ([16b6c5f](https://github.com/Firna-AI/remote-code/commit/16b6c5f7d996594c228972975d5cc49c821f2a7d))
* **marketing:** reflect planned terminal tabs and fast mode ([#190](https://github.com/Firna-AI/remote-code/issues/190)) ([ee6a69c](https://github.com/Firna-AI/remote-code/commit/ee6a69cd965967b0d38f59879cbda109e4c178ee))
* **marketing:** refresh comparison after recent merges ([#184](https://github.com/Firna-AI/remote-code/issues/184)) ([d1abf38](https://github.com/Firna-AI/remote-code/commit/d1abf38e582db8342ba27b7bab6d18c9509f1ca2))
* **runner:** list the changed files of a stopped turn ([#187](https://github.com/Firna-AI/remote-code/issues/187)) ([7273571](https://github.com/Firna-AI/remote-code/commit/72735714007be58da19cb37d03e03f8d508971fa))
* **test-support:** await native input before draining output ([27f888f](https://github.com/Firna-AI/remote-code/commit/27f888f4a600ffa399f26c54bf269b220b06ecf3))
* **workspaces:** give commits in cloud computers an author ([#181](https://github.com/Firna-AI/remote-code/issues/181)) ([076ce5c](https://github.com/Firna-AI/remote-code/commit/076ce5c1b12bf97d9ae06d2759fc69784374ed1c))

## [0.5.0](https://github.com/Firna-AI/remote-code/compare/v0.4.0...v0.5.0) (2026-11-10)


### Features

* **chat:** add the @ list of files and file chips ([#145](https://github.com/Firna-AI/remote-code/issues/145)) ([df93a19](https://github.com/Firna-AI/remote-code/commit/df93a19147b1b63b877575ef9e344201c5856a4a))
* **gateway:** keep agent logins out of cloud computers ([#173](https://github.com/Firna-AI/remote-code/issues/173)) ([a200a53](https://github.com/Firna-AI/remote-code/commit/a200a5326f3e13d3ec71a2d64d504622d9e183a5))
* keep one record of every cloud computer ([#151](https://github.com/Firna-AI/remote-code/issues/151)) ([a1bbd7f](https://github.com/Firna-AI/remote-code/commit/a1bbd7f8c6f72faa1d43facdd515e541c245c7db))
* **marketing:** add Markdown product documentation ([#133](https://github.com/Firna-AI/remote-code/issues/133)) ([8567cfb](https://github.com/Firna-AI/remote-code/commit/8567cfb620d9ecea59d555cae594dd29ce383d58))
* **models:** offer GPT-6 Astra, GPT-6.1 Terra, and GPT-6 Luna ([#155](https://github.com/Firna-AI/remote-code/issues/155)) ([24601a3](https://github.com/Firna-AI/remote-code/commit/24601a32115f4c76dbefbe401e3296b089709b31))
* **previews:** give previewed servers their local Host through a relay ([#160](https://github.com/Firna-AI/remote-code/issues/160)) ([0315aa5](https://github.com/Firna-AI/remote-code/commit/0315aa5e354c76c86b903e67766cf1ef99fe46ec))
* **workspaces:** add right-click workspace actions ([#139](https://github.com/Firna-AI/remote-code/issues/139)) ([ebfc286](https://github.com/Firna-AI/remote-code/commit/ebfc286b19198bd489997102f497944b13e4a743))


### Bug Fixes

* **lifecycle:** scope computer ledger identities by provider account ([5095987](https://github.com/Firna-AI/remote-code/commit/50959871fa67d377d3e24c475ac02574739240f0))
* **marketing:** make the website logo 25 px high ([#136](https://github.com/Firna-AI/remote-code/issues/136)) ([ba0c19d](https://github.com/Firna-AI/remote-code/commit/ba0c19d411a4132ee5b0c20862a3c6f221f6c6e0))
* **marketing:** mark workspace Restore as in progress ([fe295f3](https://github.com/Firna-AI/remote-code/commit/fe295f385e35a0bd33e674da1f58de0f8fe2dd1b))
* **marketing:** refresh comparison docs and planned features ([#157](https://github.com/Firna-AI/remote-code/issues/157)) ([7c8bcde](https://github.com/Firna-AI/remote-code/commit/7c8bcdec09296da27102519346e6b44a32be6680))
* **marketing:** refresh comparison feature progress ([3369dea](https://github.com/Firna-AI/remote-code/commit/3369dead6a28f1fb24cc05d57bf65a6e2f292242))
* **marketing:** refresh comparison progress and billing scope ([#150](https://github.com/Firna-AI/remote-code/issues/150)) ([cd233db](https://github.com/Firna-AI/remote-code/commit/cd233dbd4740b701405c64b7caaea35b41442b19))
* **members:** close owner popover when preview takes focus ([#149](https://github.com/Firna-AI/remote-code/issues/149)) ([92f9397](https://github.com/Firna-AI/remote-code/commit/92f9397745bec38138ba33733dca801b5aba7551))
* **merge:** combine provider accounts and the computer ledger ([d4ff458](https://github.com/Firna-AI/remote-code/commit/d4ff45868cbf99052a6a666eccb04ca7dfcb64fe))
* **terminal:** select and copy text while programs use the mouse ([#172](https://github.com/Firna-AI/remote-code/issues/172)) ([fcc2444](https://github.com/Firna-AI/remote-code/commit/fcc24440603171fc9c7b695c6bea8990ae5508b4))
* **workspaces:** remove the start limit note from the chat ([#162](https://github.com/Firna-AI/remote-code/issues/162)) ([ae736ab](https://github.com/Firna-AI/remote-code/commit/ae736ab5f23708d66ec684586cd3faf706ea6a4d))

## [0.4.0](https://github.com/Firna-AI/remote-code/compare/v0.3.0...v0.4.0) (2026-11-10)


### Features

* add chat attachments and lifecycle, doc, and chat write fixes ([#90](https://github.com/Firna-AI/remote-code/issues/90)) ([ab58467](https://github.com/Firna-AI/remote-code/commit/ab5846798e6a4994de212b361fdb793a2a2c8ba8))
* **marketing:** add Mac app downloads to the site ([#130](https://github.com/Firna-AI/remote-code/issues/130)) ([073f71b](https://github.com/Firna-AI/remote-code/commit/073f71b57dbf2b9cc4e6a61d155c8b3d1ac9c0ab))


### Bug Fixes

* **marketing:** align Conductor comparison with active work ([#144](https://github.com/Firna-AI/remote-code/issues/144)) ([83dfb14](https://github.com/Firna-AI/remote-code/commit/83dfb14b15fab476d75133a5f9f77db8fbca7064))
* **marketing:** mark merged chat attachments as available ([#147](https://github.com/Firna-AI/remote-code/issues/147)) ([1a9e75a](https://github.com/Firna-AI/remote-code/commit/1a9e75a7a075f3360aa2b4681761cd85f49a8d4d))
* **marketing:** refresh Conductor comparison progress ([552222e](https://github.com/Firna-AI/remote-code/commit/552222e992a168f4696793c178c7a59c5164988a))

## [0.3.0](https://github.com/Firna-AI/remote-code/compare/v0.2.0...v0.3.0) (2026-11-10)


### Features

* **chat:** render Markdown tables in agent replies ([#119](https://github.com/Firna-AI/remote-code/issues/119)) ([712afd8](https://github.com/Firna-AI/remote-code/commit/712afd8f97dd2264e570b9b05fa3db87bc39163e))
* draw Mac app downloads and give release DMGs fixed names ([#128](https://github.com/Firna-AI/remote-code/issues/128)) ([c49a4f8](https://github.com/Firna-AI/remote-code/commit/c49a4f8e52a92dc9abcf645681851c4402296740))
* **marketing:** add the Conductor Cloud feature comparison ([#129](https://github.com/Firna-AI/remote-code/issues/129)) ([8999b4b](https://github.com/Firna-AI/remote-code/commit/8999b4b46f356fee1245905843b91c22fe8024d2))
* **models:** deploy the model list from the repository ([#131](https://github.com/Firna-AI/remote-code/issues/131)) ([422f96e](https://github.com/Firna-AI/remote-code/commit/422f96e72f862e636d583c9193fee7472d06d6fb))
* **runner:** send stable workspace instructions and sender context ([#112](https://github.com/Firna-AI/remote-code/issues/112)) ([de36738](https://github.com/Firna-AI/remote-code/commit/de367388a42b4e4940abc6a522dc73bdf7751cb6))
* **waitlist:** add controlled access and invite codes ([#116](https://github.com/Firna-AI/remote-code/issues/116)) ([af96807](https://github.com/Firna-AI/remote-code/commit/af96807f6b1ee20fabd73df0bdd664f15423d5ec))
* **workspaces:** add workspace numbers and link chips ([#118](https://github.com/Firna-AI/remote-code/issues/118)) ([374260b](https://github.com/Firna-AI/remote-code/commit/374260b8509a2bce3145f2583ddb28f5c650ee39))


### Bug Fixes

* **chat:** add space between workspace chips and the cursor ([#125](https://github.com/Firna-AI/remote-code/issues/125)) ([3875aa0](https://github.com/Firna-AI/remote-code/commit/3875aa05d343588e4a702301f02eb4fab8c8df88))
* **chat:** align history button and hide it when empty ([#126](https://github.com/Firna-AI/remote-code/issues/126)) ([718e192](https://github.com/Firna-AI/remote-code/commit/718e19200ee7aa2776a886a80d2f0849144c81f6))
* **desktop:** configure preview origins in Mac builds ([#114](https://github.com/Firna-AI/remote-code/issues/114)) ([8bccd3c](https://github.com/Firna-AI/remote-code/commit/8bccd3ca5c1003dadaad1aa165510085aa58e8b1))
* **github:** authenticate CLI commands in cloud computers ([#110](https://github.com/Firna-AI/remote-code/issues/110)) ([7e23773](https://github.com/Firna-AI/remote-code/commit/7e23773fe8b13ecd1b11c6292a3c5d417360715c))
* **mail:** send Resend requests that the Workers runtime accepts ([#132](https://github.com/Firna-AI/remote-code/issues/132)) ([b9d3f40](https://github.com/Firna-AI/remote-code/commit/b9d3f40bf6896aa79b110bd579a67b46450ec054))
* **marketing:** refresh Conductor comparison statuses ([#134](https://github.com/Firna-AI/remote-code/issues/134)) ([fc2c009](https://github.com/Firna-AI/remote-code/commit/fc2c0099d457a206606d2693649caa78fb638c56))
* **mockups:** move the invite code to the end of the Account page ([af96807](https://github.com/Firna-AI/remote-code/commit/af96807f6b1ee20fabd73df0bdd664f15423d5ec))
* **previews:** preserve the launch page referrer policy ([#113](https://github.com/Firna-AI/remote-code/issues/113)) ([fc2f874](https://github.com/Firna-AI/remote-code/commit/fc2f874472218a68382dc7af2f2191739c12db31))
* reorder section menu actions ([#117](https://github.com/Firna-AI/remote-code/issues/117)) ([d4c2f12](https://github.com/Firna-AI/remote-code/commit/d4c2f12cfe45be5149af81e1ed0e3e21a340a4ac))
* **terminal:** restore output history scrolling ([#115](https://github.com/Firna-AI/remote-code/issues/115)) ([e6ebc09](https://github.com/Firna-AI/remote-code/commit/e6ebc0912384dacb386f8418363bedb9be7f6a66))
* **terminal:** show only the current folder in the prompt ([#127](https://github.com/Firna-AI/remote-code/issues/127)) ([68e001d](https://github.com/Firna-AI/remote-code/commit/68e001d145025033b96a0d464b8178dcb2506a37))
* **worker:** keep the scheduled repairs going when an email retry fails ([af96807](https://github.com/Firna-AI/remote-code/commit/af96807f6b1ee20fabd73df0bdd664f15423d5ec))
* **workspace:** remove the branch name from the header ([#122](https://github.com/Firna-AI/remote-code/issues/122)) ([b5ac64c](https://github.com/Firna-AI/remote-code/commit/b5ac64c27724085e9e502905ce51ef26c3c9bb5b))
* **workspaces:** move Archive to workspace rows ([#124](https://github.com/Firna-AI/remote-code/issues/124)) ([c02744f](https://github.com/Firna-AI/remote-code/commit/c02744f0ae9834e246d72ece451e6e9e99eaff4a))

## [0.2.0](https://github.com/Firna-AI/remote-code/compare/v0.1.0...v0.2.0) (2026-11-09)


### Features

* **onboarding:** build the cloud computer of a new org automatically ([#92](https://github.com/Firna-AI/remote-code/issues/92)) ([701c753](https://github.com/Firna-AI/remote-code/commit/701c753caf6c71a9a356ce7fd306304a0df22389))
* **tabs:** move any tab by drag or from a tab menu ([623dbe5](https://github.com/Firna-AI/remote-code/commit/623dbe511918adc39799693ba559838550cdb116))


### Bug Fixes

* **desktop:** pass signing secrets to the reusable release job ([#109](https://github.com/Firna-AI/remote-code/issues/109)) ([ed88e9b](https://github.com/Firna-AI/remote-code/commit/ed88e9b194241e3e73453664b254822adcb719a5))
* **marketing:** complete the Terms and Privacy pages ([#97](https://github.com/Firna-AI/remote-code/issues/97)) ([dbb3d26](https://github.com/Firna-AI/remote-code/commit/dbb3d26d71d40b15af83c6e4ea1492c404939c06))
* restore cursor at end of New workspace drafts ([#105](https://github.com/Firna-AI/remote-code/issues/105)) ([f1eb355](https://github.com/Firna-AI/remote-code/commit/f1eb3555ff8c6cdcccc11c68f08cb98216d823a3))
* **workspace:** hide the Desktop panel for now ([#107](https://github.com/Firna-AI/remote-code/issues/107)) ([7ebecf7](https://github.com/Firna-AI/remote-code/commit/7ebecf778382075fef1d1fb3a372ebda45a7e45f))

## 0.1.0 (2026-11-09)


### Features

* add Preferences and a New workspace dialog ([#73](https://github.com/Firna-AI/remote-code/issues/73)) ([50a4e5e](https://github.com/Firna-AI/remote-code/commit/50a4e5e814d5344731d8c4c10a0a730f5b8dd23d))
* add the operator section: stats, search, suspend, lift ([#89](https://github.com/Firna-AI/remote-code/issues/89)) ([fc36467](https://github.com/Firna-AI/remote-code/commit/fc36467f14dc6b19ca461541e7e1da8677ce5733))
* **chat:** fold the work of an ended turn ([#91](https://github.com/Firna-AI/remote-code/issues/91)) ([97f90da](https://github.com/Firna-AI/remote-code/commit/97f90da1b2e1d7d863a217799575b897d1caded3))
* **desktop:** publish signed Mac releases and enable updates ([#100](https://github.com/Firna-AI/remote-code/issues/100)) ([307dd03](https://github.com/Firna-AI/remote-code/commit/307dd03eaab4be99a22b58676e6ee3fe34e2f24b))
* keep the workspace after a failed first start ([#86](https://github.com/Firna-AI/remote-code/issues/86)) ([690353a](https://github.com/Firna-AI/remote-code/commit/690353aa692dc044012fca65a7eda262eed6f5ec))
* **marketing:** add GitHub link to the site navigation ([#99](https://github.com/Firna-AI/remote-code/issues/99)) ([a899886](https://github.com/Firna-AI/remote-code/commit/a8998869f6812b34ac198bfe407238287c59a4ea))
* name new workspaces from their first message ([#87](https://github.com/Firna-AI/remote-code/issues/87)) ([e7aa864](https://github.com/Firna-AI/remote-code/commit/e7aa8641340c4d05e183215c3a96751f7404d8ff))
* **palette:** show the state of data that did not load ([#84](https://github.com/Firna-AI/remote-code/issues/84)) ([8cf1599](https://github.com/Firna-AI/remote-code/commit/8cf15996ac5a6a85dee54f632a77a628d1d3ca7f))
* **tools:** list repositories, sections, and models for agents ([#88](https://github.com/Firna-AI/remote-code/issues/88)) ([9f651e1](https://github.com/Firna-AI/remote-code/commit/9f651e1de51764ebaec31fa015cfa0218b54afb8))


### Bug Fixes

* **chat:** name only another member's login, inside the composer box ([c7cec44](https://github.com/Firna-AI/remote-code/commit/c7cec44e9f7d7479b66ef9bb04ced833d94d9871))
* **chat:** remove the steer hint below the message box ([da8f051](https://github.com/Firna-AI/remote-code/commit/da8f0519e9fc22ac609e4242a5bb555fccceeb6f))
* **chat:** restore automatic workspace titles ([#101](https://github.com/Firna-AI/remote-code/issues/101)) ([54a5b2e](https://github.com/Firna-AI/remote-code/commit/54a5b2e326df996dfa62bc12ce21c44374b3fe4f))
* **github:** return users to the app after a GitHub App install ([#68](https://github.com/Firna-AI/remote-code/issues/68)) ([6c3a1f3](https://github.com/Firna-AI/remote-code/commit/6c3a1f3174de21aa5dda8890e315138fa36313f1))
* **list:** keep one draft for General ([50a4e5e](https://github.com/Firna-AI/remote-code/commit/50a4e5e814d5344731d8c4c10a0a730f5b8dd23d))
* **runner:** match background results to outstanding user input ([#83](https://github.com/Firna-AI/remote-code/issues/83)) ([6d0b648](https://github.com/Firna-AI/remote-code/commit/6d0b64878c878733fd37b676c037c7aa348073eb))
* **shell:** give the focus back after a press outside a modal layer ([50a4e5e](https://github.com/Firna-AI/remote-code/commit/50a4e5e814d5344731d8c4c10a0a730f5b8dd23d))
* **tools:** give an unknown CLI command the command help ([9f651e1](https://github.com/Firna-AI/remote-code/commit/9f651e1de51764ebaec31fa015cfa0218b54afb8))
