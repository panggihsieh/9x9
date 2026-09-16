# 第三版：Firebase 班級測驗

這是獨立於第二版的第三版分支版本，功能目標是 Kahoot 式班級代碼登入與老師監控 dashboard。

## 功能

- 老師免登入建立或開啟班級代碼。
- 學生輸入班級代碼與姓名加入。
- 班級最多 100 位學生，超過會禁止加入。
- 老師畫面顯示登入人數，可按「開始練習」讓學生進入個人測驗。
- 學生進入第二版概念的個人練習畫面，完成因數、因數配對、質因數分解三項。
- 老師 dashboard 即時顯示每位學生的 1、2、3 項完成狀態、分數與前 5 名。
- 老師按「結束班級」會清空 Firestore 中該班級資料。
- 後台管理畫面支援 Google 登入，只有 `firebase-config.js` 中列出的老師 email 可以進入。

## 設定 Firebase

1. 建立 Firebase 專案。
2. 開啟 Firestore Database。
3. 開啟 Authentication 的 Google 登入。
4. 複製 `firebase-config.example.js` 為 `firebase-config.js`，填入你的 Firebase 專案設定。
5. 將 `firestore.rules` 發布到 Firestore Rules。

目前 `firebase-config.js` 會先引用 example 設定，方便頁面能載入；正式使用前請改成真實設定。

## 本機測試

在專案根目錄啟動靜態伺服器後開啟：

```bash
python -m http.server 8080
```

然後前往：

```text
http://localhost:8080/v3/
```
