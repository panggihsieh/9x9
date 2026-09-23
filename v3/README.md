# 第三版：個人開課與全班同步比賽

直接開啟 https://panggihsieh.github.io/9x9/v3/ 。首頁不提供第三版入口，但網址並非私人存取限制。

## 開課與管理

老師先輸入後台核發的四碼數字授權密碼，再選擇教室模式與班級代碼開課。未驗證、換 Firebase 身分、重新整理或登入逾一小時，開課按鈕保持停用。Firebase 規則亦檢查有效授權，無法只修改按鈕繞過。班級所有權仍由匿名登入的 `teacherUid` 核對。

班級代碼由瀏覽器自動產生四碼數字，不接受手動輸入。首次進入、練習時間結束，以及結束並釋放班級後都會準備新的代碼；開課交易若遇到等待中或練習中的代碼，會自動換碼重試。Firebase 交易會在建立前再次檢查，因此線上的每一間班級代碼皆相異。學生每次加入都會重新讀取該班的教室模式與倒數狀態。

後台僅允許 Google 驗證的 `teacher.hsieh@gmail.com` 新增及編輯多組密碼、備註、啟用或停用。部署後須由管理員先核發至少一組；沒有內建預設密碼。儲存或切換啟用狀態會使舊授權失效，老師需重新驗證才能再次開課或開始練習；不會刪除既有答題資料。

`teacherAuthorizationCodes` 僅管理員可讀寫；嘗試和授權紀錄只能由本人存取，不把密碼寫入公開班級文件。每個匿名身分的驗證嘗試須間隔五秒。此為四碼共用開課授權，並非具名教師帳號；五秒限制以 UID 計算，不能取代全站防暴力猜測機制。

學生以代碼及姓名加入，每班上限 100 人。成績每 15 秒合併同題進度，換題前與時間到會補送；只由老師查詢前 10 名。斷線未同步資料保存在原裝置。開始、釋放、計分與防重複規則仍由 Firestore 檢查。

## 開發與發布

使用 Firebase Authentication 的 Anonymous 與 Google 提供者、Firestore 與 Hosting，不需要 Cloud Functions。測試優先使用本機模擬器，避免消耗正式配額。

```powershell
node --test tests/*.test.cjs tests/*.test.mjs
npx --yes firebase-tools@13.35.1 emulators:exec --config firebase.emulators.json --only firestore,auth --project demo-factor-game "node tests/firestore-live.cjs"
npx firebase-tools deploy --only "firestore,hosting" --project x9-factor-game
```

上述模擬器指令搭配 Java 17；新版 Firebase CLI 的 Java 要求請依其版本設定。本機預覽：`python -m http.server 8765`。

詳細節省用量的原因、同步與補傳限制，請見專案根目錄 README 的精簡排行榜模式說明。
