/** Public, non-secret simulator settings read from the environment at runtime. */
export default publicHandler(async () => ({ receiptHost: useEnv().RECEIPT_HOST }));
