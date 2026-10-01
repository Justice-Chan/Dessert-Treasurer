function openReceiptDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(receiptDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(receiptStoreName)) {
        const store = db.createObjectStore(receiptStoreName, { keyPath: "id" });
        store.createIndex("claimId", "claimId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function receiptTransaction(mode, callback) {
  const db = await openReceiptDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(receiptStoreName, mode);
    const store = transaction.objectStore(receiptStoreName);
    let settled = false;
    let result;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      db.close();
      reject(error || transaction.error || new Error("附件資料庫操作失敗。"));
    };
    try {
      result = callback(store);
    } catch (error) {
      transaction.abort();
      fail(error);
      return;
    }
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      db.close();
      resolve(result);
    };
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error);
  });
}

async function storeReceiptFiles(claimId, files) {
  if (!files.length) return [];
  files.forEach((file) => {
    if (file.size > 12 * 1024 * 1024) throw new Error(`附件 ${file.name} 超過 12 MB`);
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") throw new Error(`附件 ${file.name} 不是支援的圖片或 PDF`);
  });
  const records = files.map((file) => ({
      id: uid(),
      claimId,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      createdAt: new Date().toISOString(),
      blob: file
  }));
  if (nativeStorageEnabled) {
    const nativeRecords = await Promise.all(records.map(async ({ blob, ...metadata }) => ({
      ...metadata,
      dataUrl: await blobToDataUrl(blob)
    })));
    await nativeStorageCall("storeReceipts", { records: nativeRecords });
    return nativeRecords.map(({ dataUrl, ...metadata }) => metadata);
  }
  await receiptTransaction("readwrite", (store) => records.forEach((record) => store.put(record)));
  return records.map(({ id, name, type, size }) => ({ id, name, type, size }));
}

async function getReceipt(id) {
  if (nativeStorageEnabled) {
    const record = await nativeStorageCall("getReceipt", { id });
    if (!record?.dataUrl) return undefined;
    const { dataUrl, ...metadata } = record;
    return { ...metadata, blob: dataUrlToBlob(dataUrl) };
  }
  const db = await openReceiptDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(receiptStoreName, "readonly").objectStore(receiptStoreName).get(id);
    request.onsuccess = () => { db.close(); resolve(request.result); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function getAllReceipts() {
  if (nativeStorageEnabled) {
    const records = await nativeStorageCall("getAllReceipts");
    return (records || []).map(({ dataUrl, ...metadata }) => ({ ...metadata, blob: dataUrlToBlob(dataUrl) }));
  }
  const db = await openReceiptDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(receiptStoreName, "readonly").objectStore(receiptStoreName).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result || []); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function deleteReceipt(id) {
  if (nativeStorageEnabled) {
    await nativeStorageCall("deleteReceipts", { ids: [id] });
    return;
  }
  await receiptTransaction("readwrite", (store) => store.delete(id));
}

async function deleteReceipts(ids) {
  if (!ids.length) return;
  if (nativeStorageEnabled) {
    await nativeStorageCall("deleteReceipts", { ids });
    return;
  }
  await receiptTransaction("readwrite", (store) => ids.forEach((id) => store.delete(id)));
}

async function deleteReceiptsForClaims(claimIds) {
  if (!claimIds.length) return;
  const wanted = new Set(claimIds);
  const receipts = await getAllReceipts();
  await deleteReceipts(receipts.filter((receipt) => wanted.has(receipt.claimId)).map((receipt) => receipt.id));
}

async function clearReceipts() {
  if (nativeStorageEnabled) {
    await nativeStorageCall("clearReceipts");
    return;
  }
  await receiptTransaction("readwrite", (store) => store.clear());
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = String(dataUrl).split(",");
  const type = /data:([^;]+)/.exec(header)?.[1] || "application/octet-stream";
  const bytes = atob(body || "");
  const array = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) array[index] = bytes.charCodeAt(index);
  return new Blob([array], { type });
}

async function exportReceipts(claimIds) {
  const wanted = claimIds ? new Set(claimIds) : null;
  const receipts = (await getAllReceipts()).filter((receipt) => !wanted || wanted.has(receipt.claimId));
  return Promise.all(receipts.map(async ({ blob, ...metadata }) => ({
    ...metadata,
    dataUrl: await blobToDataUrl(blob)
  })));
}

async function importReceipts(receipts = [], replacedClaimIds = null) {
  if (nativeStorageEnabled) {
    await nativeStorageCall("importReceipts", { receipts, replacedClaimIds });
    return;
  }
  const records = receipts.filter((receipt) => receipt.id && receipt.dataUrl).map((receipt) => ({
      id: receipt.id,
      claimId: receipt.claimId,
      name: receipt.name,
      type: receipt.type,
      size: Number(receipt.size) || 0,
      createdAt: receipt.createdAt || new Date().toISOString(),
      blob: dataUrlToBlob(receipt.dataUrl)
  }));
  const previousReceipts = replacedClaimIds ? await getAllReceipts() : [];
  const replaced = replacedClaimIds ? new Set(replacedClaimIds) : null;
  await receiptTransaction("readwrite", (store) => {
    if (replaced) previousReceipts.filter((receipt) => replaced.has(receipt.claimId)).forEach((receipt) => store.delete(receipt.id));
    else store.clear();
    records.forEach((record) => store.put(record));
  });
}

