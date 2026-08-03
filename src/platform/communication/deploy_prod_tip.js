const DEPLOY_PROD_TIP_TEXT =
  "Pro tip: you can use /conductor deploy prod instead.";

function shouldSendDeployProdTip(rawText) {
  return normalizeMessageText(rawText) === "deploying prod";
}

function normalizeMessageText(rawText) {
  return String(rawText || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "");
}

module.exports = {
  DEPLOY_PROD_TIP_TEXT,
  shouldSendDeployProdTip,
};
