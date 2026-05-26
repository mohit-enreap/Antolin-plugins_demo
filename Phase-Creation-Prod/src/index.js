import Resolver from "@forge/resolver";
import api, { storage, route } from "@forge/api";
import pako from "pako";
import { Queue } from "@forge/events";
import { cloneElement } from "react";

const taskQueue = new Queue({ key: "task-queue" });
const updateKPIQueue = new Queue({ key: "kpi-update-queue" });
const updateLogQueue = new Queue({ key: "log-update-queue" });
const updateTodayQueue = new Queue({ key: "update-today-queue" });
const updateQuotationQueue = new Queue({ key: "quotation-update-queue" });

const resolver = new Resolver();
const resolver1 = new Resolver();

function uint8ArrayToBase64(uint8Arr) {
  let CHUNK_SIZE = 0x8000; // To avoid "maximum call stack size exceeded" for large data
  let chunks = [];
  for (let i = 0; i < uint8Arr.length; i += CHUNK_SIZE) {
    chunks.push(
      String.fromCharCode.apply(null, uint8Arr.subarray(i, i + CHUNK_SIZE)),
    );
  }
  const binaryString = chunks.join("");
  return btoa(binaryString);
}
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Utility functions
async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generic retry wrapper for Jira API calls
// Enhanced retry wrapper following Atlassian API Rate Limit best practices
async function retryJiraApiCall(apiCall, maxRetries = 5, baseDelayMs = 10000) {
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const response = await apiCall();

      if (response.ok || response.status == 400 || response.status == 404) {
        return response;
      }

      const status = response.status;
      console.warn(
        `API call failed with status ${status}. Attempt ${retryCount + 1}/${maxRetries + 1}`,
      );

      // Check if we should retry based on status code
      const shouldRetry =
        (status === 429 || status >= 500) && retryCount < maxRetries;

      if (!shouldRetry) {
        const errorText = await response
          .text()
          .catch(() => "Unable to read response");
        throw new Error(
          `API call failed after ${retryCount + 1} attempts. Final status: ${status} - ${errorText}`,
        );
      }

      // Calculate delay based on response headers and exponential backoff
      let delayMs = baseDelayMs;

      // Check for Retry-After header (rate limiting)
      const retryAfterHeader = response.headers.get("Retry-After");
      if (retryAfterHeader) {
        const retryAfterSeconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(retryAfterSeconds)) {
          delayMs = retryAfterSeconds * 1000; // Convert to milliseconds
          console.log(
            `Rate limited. Using Retry-After header: ${retryAfterSeconds}s`,
          );
        }
      } else {
        // Use exponential backoff with jitter for other errors
        const exponentialDelay = Math.pow(2, retryCount) * baseDelayMs;
        const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
        delayMs = exponentialDelay + jitter;

        // Cap maximum delay at 30 seconds
        delayMs = Math.min(delayMs, 30000);
      }

      retryCount++;
      console.log(
        `Retrying in ${Math.round(delayMs)}ms... (${retryCount}/${maxRetries})`,
      );
      await delay(delayMs);
    } catch (error) {
      // Handle network errors and other exceptions
      console.error(
        `API call attempt ${retryCount + 1} failed:`,
        error.message,
      );

      if (retryCount === maxRetries) {
        throw error;
      }

      // For network errors, use exponential backoff
      const exponentialDelay = Math.pow(2, retryCount) * baseDelayMs;
      const jitter = Math.random() * 0.1 * exponentialDelay;
      const delayMs = Math.min(exponentialDelay + jitter, 30000);

      retryCount++;
      console.log(
        `Network error. Retrying in ${Math.round(delayMs)}ms... (${retryCount}/${maxRetries})`,
      );
      await delay(delayMs);
    }
  }
}

// Helper function to fetch existing linked issues
async function fetchLinkedIssues(issueKey) {
  console.log(`Fetching linked issues for ${issueKey}`);

  const response = await retryJiraApiCall(() =>
    api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }),
  );

  const parentIssue = await response.json();
  const linkedIssues = parentIssue.fields.issuelinks || [];

  return linkedIssues
    .map((link) => {
      if (link.outwardIssue) {
        return {
          key: link.outwardIssue.key,
          summary: link.outwardIssue.fields.summary,
        };
      }
      if (link.inwardIssue) {
        return {
          key: link.inwardIssue.key,
          summary: link.inwardIssue.fields.summary,
        };
      }
      return null;
    })
    .filter(Boolean);
}

async function fetchIssue(issueKey) {
  console.log(`Fetching issue ${issueKey}`);

  const response = await retryJiraApiCall(() =>
    api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }),
  );

  return await response.json();
}

// Helper function to create an issue in Jira
async function createIssue({ projectId, issueTypeId, summary, ...fields }) {
  const issuePayload = {
    fields: {
      project: { id: projectId },
      issuetype: { id: issueTypeId },
      summary,
      ...fields,
    },
  };

  console.log(`Creating issue: ${summary}`);

  const response = await retryJiraApiCall(() =>
    api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: "POST",
      body: JSON.stringify(issuePayload),
      headers: {
        "Content-Type": "application/json",
      },
    }),
  );

  // Read the body once
  let body;
  try {
    body = await response.json();
  } catch (err) {
    // If response is not JSON, fallback to text for debugging
    const text = await response.text().catch(() => "<unable to read body>");
    console.error("Failed to parse JSON response. Raw response:", text);
    throw err;
  }

  console.log("Create Response body:", body);

  if (!response.ok) {
    // Helpful debugging: include status and body
    const errMsg = `Create issue failed: ${response.status} ${response.statusText} - ${JSON.stringify(body)}`;
    console.error(errMsg);
    throw new Error(errMsg);
  }

  return body;
}

// Helper function to link issues in Jira with dedicated retry logic
async function linkIssues({ inwardIssueKey, outwardIssueKey }, maxRetries = 3) {
  const linkPayload = {
    type: { name: "Hierarchy link (WBSGantt)" },
    inwardIssue: { key: inwardIssueKey },
    outwardIssue: { key: outwardIssueKey },
  };

  let lastError = null;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      console.log(
        `Linking issues: ${inwardIssueKey} -> ${outwardIssueKey} (Attempt ${retryCount + 1}/${maxRetries + 1})`,
      );

      // Add delay before linking to ensure the issue is indexed in Jira
      await delay(1200);

      const response = await retryJiraApiCall(() =>
        api.asApp().requestJira(route`/rest/api/3/issueLink`, {
          method: "POST",
          body: JSON.stringify(linkPayload),
          headers: { "Content-Type": "application/json" },
        }),
      );

      // Validate the response
      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => "Unable to read error response");
        throw new Error(
          `Failed to link. Status: ${response.status} - ${errorText}`,
        );
      }

      console.log(
        `Successfully linked: ${inwardIssueKey} -> ${outwardIssueKey}`,
      );
      return response;
    } catch (error) {
      lastError = error;
      retryCount++;

      if (retryCount <= maxRetries) {
        // Calculate exponential backoff: 2s, 4s, 8s
        const delayMs = Math.pow(2, retryCount) * 1000;
        console.warn(
          `Linking failed (Attempt ${retryCount}/${maxRetries + 1}): ${error.message}. Retrying in ${delayMs}ms...`,
        );
        await delay(delayMs);
      }
    }
  }

  // All retries exhausted
  const errMsg = `Failed to link ${inwardIssueKey} -> ${outwardIssueKey} after ${maxRetries + 1} attempts. Final error: ${lastError.message}`;
  console.error(errMsg);
  throw new Error(errMsg);
}

async function updateIssueWithRetry(issueKey, fieldsToUpdate) {
  console.log(`Updating issue ${issueKey}`);

  const response = await retryJiraApiCall(() =>
    api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: fieldsToUpdate,
      }),
    }),
  );

  return response;
}
function getKeyBySummary(data, summary) {
  const item = data.find((obj) => obj.summary.includes(summary));
  return item ? item.key : null;
}

const calculateAndUpdateField = async (parentIssueKey) => {
  try {
    // Step 1: Fetch the parent issue data (to get linked issues)
    console.log(
      `Calculating and updating field for parent issue: ${parentIssueKey}`,
    );

    const parentIssueResponse = await retryJiraApiCall(() =>
      api
        .asApp()
        .requestJira(
          route`/rest/api/3/issue/${parentIssueKey}?fields=issuelinks`,
          {
            method: "GET",
          },
        ),
    );

    if (!parentIssueResponse.ok) {
      throw new Error(
        `Failed to fetch parent issue data: ${parentIssueResponse.status}`,
      );
    }

    const parentIssueData = await parentIssueResponse.json();
    const issueLinks = parentIssueData.fields.issuelinks || [];

    // Step 2: Filter outward issues
    const outwardIssues = issueLinks
      .filter((link) => link.outwardIssue)
      .map((link) => link.outwardIssue.key);

    if (outwardIssues.length === 0) {
      console.log("No outward issues found for calculateAndUpdateField.");
      return 0; // FIXED: Return 0 instead of undefined
    }

    console.log(`Found ${outwardIssues.length} child issues to calculate from`);

    // Step 3: Fetch customfield_10061 values for each outward issue
    let totalSum = 0;

    for (const issueKey of outwardIssues) {
      const issueResponse = await retryJiraApiCall(() =>
        api
          .asApp()
          .requestJira(
            route`/rest/api/3/issue/${issueKey}?fields=customfield_10061`,
            {
              method: "GET",
            },
          ),
      );

      if (issueResponse.ok) {
        const issueData = await issueResponse.json();
        const fieldValue = issueData.fields.customfield_10061 || 0;
        console.log(`Issue ${issueKey} - Standard Hours: ${fieldValue}`);
        totalSum += fieldValue;
      } else {
        console.error(
          `Failed to fetch data for issue ${issueKey}: ${error.message}`,
        );
      }
    }
    console.log(`Total sum of child standard hours: ${totalSum}`);

    // Step 4: Update the parent issue field with the sum
    const updateResponse = await retryJiraApiCall(() =>
      api.asApp().requestJira(route`/rest/api/3/issue/${parentIssueKey}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            customfield_10061: Number(totalSum?.toFixed(1)) || null,
          },
        }),
      }),
    );

    if (!updateResponse.ok) {
      throw new Error(
        `Failed to update parent issue field: ${updateResponse.status}`,
      );
    }

    console.log(
      `Successfully updated parent issue ${parentIssueKey} with total sum: ${totalSum}`,
    );
  } catch (error) {
    console.error("Error in calculateAndUpdateField:", error);
  }
};

// Helper function to calculate TDL, COO, DE depending on Part Name selection
function calculateSumsWithTotal(data, keysToConsider) {
  Object.keys(data).forEach((section) => {
    // Filter keys to check for existence
    const validKeys = keysToConsider.filter((key) => data[section][key]);

    if (validKeys.length === 0) {
      console.warn(`No valid keys found for section: ${section}`);
      return; // Skip this section
    }

    let totals = { TDL: 0, DE: 0, COO: 0 };

    validKeys.forEach((key) => {
      const part = data[section][key];
      totals.TDL += part.TDL || 0;
      totals.DE += part.DE || 0;
      totals.COO += part.COO || 0;
    });

    // Calculate total and standard
    // const total = totals.TDL + totals.DE + totals.COO;
    // const standard = total;
    const standard = totals.TDL + totals.DE + totals.COO;
    const total = 0;

    // Update the totals in the section
    data[section].TDL = totals.TDL;
    data[section].DE = totals.DE;
    data[section].COO = totals.COO;
    data[section].total = total;
    data[section].standard = standard;

    // if()
  });

  return data;
}

// Resolver to get stored data
resolver.define("getData", async ({ payload }) => {
  const { issueKey, phase } = payload;
  const storedData = await storage.get(`${issueKey}_${phase}`);
  // console.log(`Retrieving Data for issueKey: ${issueKey}`);
  return storedData || null;
});

resolver.define("setData", async ({ payload }) => {
  // Push the task to the queue
  await taskQueue.push(payload);
  return { success: true, message: "Task has been queued for processing." };
});

// Resolver to handle data from UI and create/link issues
resolver1.define("create-activity", async ({ payload }) => {
  const { issueKey, base64Data } = payload;

  // Save data in Forge storage

  // Decompress and parse the data
  const compressedData = Buffer.from(base64Data, "base64");
  const jsonString = pako.inflate(compressedData, { to: "string" });
  const data = JSON.parse(jsonString);

  const {
    phaseName,
    extraWork,
    milestones,
    activities,
    totalHours,
    _3DModification,
    _2DModification,
    dataManagement,
  } = data;
  await storage.set(`${issueKey}_${phaseName.value}`, base64Data);
  await storage.set(`${issueKey}_Industrialization_${phaseName.value}`, {
    _3DModification,
    _2DModification,
    dataManagement,
  });

  console.log(JSON.stringify(activities));
  console.log("phase :", phaseName);
  // Fetch parent issue details

  // const parentIssueResponse = await fetchIssue(issueKey);
  const parentIssueResponse = await retryJiraApiCall(() =>
    api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }),
  );

  if (!parentIssueResponse.ok) {
    throw new Error(
      `Failed to fetch parent issue: ${parentIssueResponse.status}`,
    );
  }

  const parentIssue = await parentIssueResponse.json();

  const projectId = parentIssue.fields.project.id;
  const productParts = parentIssue.fields["customfield_10074"].map(
    (element) => element.value,
  );

  // console.log(`Parent Issue Fetched: ${JSON.stringify(parentIssue)}`);
  let existingIssues = await fetchLinkedIssues(issueKey);
  console.log(existingIssues);

  const linkKey = getKeyBySummary(existingIssues, phaseName.value);
  const updateResponse = await retryJiraApiCall(() =>
    api.asApp().requestJira(route`/rest/api/3/issue/${linkKey}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          customfield_10061: Number(totalHours?.toFixed(1)),
        },
      }),
    }),
  );
  existingIssues = await fetchLinkedIssues(linkKey);

  // return
  // Process checked milestones only
  for (const [milestoneKey, { order, checked, loops }] of Object.entries(
    milestones,
  )) {
    if (!checked) continue; // Skip unchecked milestones

    const [milestone0, milestone1] = milestoneKey.split("|");
    for (let loop = 1; loop <= loops; loop++) {
      const summary = `${order} ${milestone0} | ${milestone1} | Loop ${loop}`;
      // Check if the activity already exists
      if (existingIssues.some((issue) => issue.summary === summary)) {
        console.log(`Skipping existing activity: ${summary}`);
        continue; // Skip already existing activities
      }

      try {
        // Create milestone issue for each loop
        const createdIssue = await createIssue({
          projectId,
          issueTypeId: "10012", // Replace with your milestone issue type ID
          summary,
          customfield_10078: issueKey, // Project Key
        });

        console.log(`Created Milestone Issue: ${createdIssue.key}`);

        // Link the created issue to the parent issue
        await linkIssues({
          inwardIssueKey: linkKey,
          outwardIssueKey: createdIssue.key,
        });

        await delay(500);
      } catch (error) {
        console.error(
          `Failed to create/link milestone: ${summary}, Error: ${error.message}`,
        );
        continue;
      }
    }
  }

  function generateADF(jsonData, parts, phase) {
    let subactivitySummary = {};

    // Process only the selected parts
    parts.forEach((part) => {
      if (jsonData[part] && jsonData[part].subactivity) {
        Object.entries(jsonData[part].subactivity).forEach(
          ([subactivity, values]) => {
            const key = subactivity.trim();
            if (!subactivitySummary[key]) {
              subactivitySummary[key] = {
                Loop: parseInt(values[phase]) || 0,
                DE: 0,
                COO: 0,
                TDL: 0,
                order: parseInt(values.order) || 999, // Default high order if missing
              };
            }
            subactivitySummary[key].DE += values.DE || 0;
            subactivitySummary[key].COO += values.COO || 0;
            subactivitySummary[key].TDL += values.TDL || 0;
          },
        );
      }
    });

    // If no subactivities exist, return a simple ADF message
    if (Object.keys(subactivitySummary).length === 0) {
      return {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "No subactivities available for the selected parts.",
              },
            ],
          },
        ],
      };
    }

    // Convert to array and sort by "order"
    let sortedSubactivities = Object.entries(subactivitySummary)
      .map(([subactivity, values]) => ({
        Subactivity: subactivity,
        ...values,
      }))
      .sort((a, b) => a.order - b.order);

    // Construct ADF table structure with correct attributes
    let adfTable = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "table",
          attrs: {
            isNumberColumnEnabled: false,
            layout: "default",
            localId: "2ca1f4d9-6184-4646-beaa-248b4da684f6",
            width: 760,
          },
          content: [
            // Group Headers
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 1 },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: { colspan: 4 },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Standard" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: { colspan: 4 },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Quoted" }],
                    },
                  ],
                },
              ],
            },
            // Sub-Headers
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Subactivity" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Loop" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "DE" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "COO" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "TDL" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Loop" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "DE" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "COO" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "TDL" }],
                    },
                  ],
                },
              ],
            },
            // Table Data Rows
            ...sortedSubactivities.map((values) => ({
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: values.Subactivity }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "1" }],
                    },
                  ],
                }, // Standard Loop is always 1
                {
                  type: "tableCell",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: values.DE.toFixed(2) }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: values.COO.toFixed(2) }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: values.TDL.toFixed(2) }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: values.Loop.toString() }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: (values.DE * values.Loop).toFixed(2),
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: (values.COO * values.Loop).toFixed(2),
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  attrs: {},
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: (values.TDL * values.Loop).toFixed(2),
                        },
                      ],
                    },
                  ],
                },
              ],
            })),
          ],
        },
        {
          type: "paragraph",
          content: [],
        },
      ],
    };

    return adfTable;
  }

  async function updateOutwardIssueCount(issueKey, customFieldId) {
    try {
      // Fetch outward issues count
      const response = await retryJiraApiCall(() =>
        api
          .asApp()
          .requestJira(route`/rest/api/3/issue/${issueKey}?fields=issuelinks`, {
            method: "GET",
            headers: { Accept: "application/json" },
          }),
      );

      const data = await response.json();
      if (!data.fields.issuelinks) return;

      // Count only outward issues of type "Hierarchy link (WBSGantt)"
      const outwardIssuesCount = data.fields.issuelinks.filter(
        (link) =>
          link.type.name === "Hierarchy link (WBSGantt)" && link.outwardIssue,
      ).length;

      // Update the issue with outward issues count
      await retryJiraApiCall(() =>
        api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            fields: {
              [customFieldId]: outwardIssuesCount - 1,
            },
          }),
        }),
      );

      console.log(
        `Updated issue ${issueKey} with outward issues count: ${outwardIssuesCount}`,
      );
    } catch (error) {
      console.error(
        `Error updating outward issue count for ${issueKey}:`,
        error,
      );
    }
  }

  // Common logic to handle loops for Standard, Extra Work, and Rework
  async function processLoops(
    loopType,
    startLoop,
    loopCount,
    additionalProps,
    type,
  ) {
    let nextLoopNumber = startLoop; // Start from the provided startLoop

    for (let loop = 1; loop <= loopCount; loop++) {
      const currentLoop = ++nextLoopNumber; // Increment the loop number for each iteration
      let activitySummary =
        `${additionalProps.order} | ${additionalProps.activity0} | ${additionalProps.activity1} | ${type} ${currentLoop}  ${loopType}`.trim();

      // Check if the activity already exists
      if (
        additionalProps.existingIssues.some(
          (issue) => issue.summary === activitySummary,
        )
      ) {
        // let iss=additionalProps.existingIssues.find((issue) => issue.summary === activitySummary)
        console.log(`Skipping existing activity: ${activitySummary}`);
        continue; // Skip already existing activities
      }

      if (activitySummary.includes("ITERATIONS | ITERATIONS"))
        activitySummary =
          `000 | ${additionalProps.activity0} | ${additionalProps.activity1} | ${type} ${currentLoop}  ${loopType}`.trim();
      try {
        // Create the Activity issue
        console.log(activities[additionalProps.activityKey]);
        console.log({
          projectId: additionalProps.projectId,
          issueTypeId: "10008", // Replace with your activity issue type ID
          summary: activitySummary,
          customfield_10077:
            loopType.includes("| Extra Work") ||
            loopType.includes("| Re-Work") ||
            type == "Iter"
              ? null
              : Number(additionalProps.TDL?.toFixed(1)),
          customfield_10075:
            loopType.includes("| Extra Work") ||
            loopType.includes("| Re-Work") ||
            type == "Iter"
              ? null
              : Number(additionalProps.COO?.toFixed(1)),
          customfield_10076:
            loopType.includes("| Extra Work") ||
            loopType.includes("| Re-Work") ||
            type == "Iter"
              ? null
              : Number(additionalProps.DE?.toFixed(1)),
          customfield_10061:
            loopType.includes("| Extra Work") ||
            loopType.includes("| Re-Work") ||
            type == "Iter"
              ? null
              : Number(additionalProps.standard?.toFixed(1)),
          customfield_10078: additionalProps.issueKey,
          customfield_10059:
            activitySummary.includes("| 2D Drawing") ||
            activitySummary.includes("| 2D DELIVERABLES")
              ? additionalProps.loop
              : null,
          customfield_10970: additionalProps.phase,
          description: generateADF(
            activities[additionalProps.activityKey],
            productParts,
            additionalProps.phase,
          ),
          assignee: {
            id:
              additionalProps.parentIssue.fields["customfield_10045"][0][
                "accountId"
              ] || null,
          },
        });
        const createdActivity = await createIssue({
          projectId: additionalProps.projectId,
          issueTypeId: "10008", // Replace with your activity issue type ID
          summary: activitySummary,
          customfield_10077:
            loopType.includes("| Extra Work") ||
            loopType.includes("| Re-Work") ||
            type == "Iter"
              ? null
              : Number(additionalProps.TDL?.toFixed(1)),
          customfield_10075:
            loopType.includes("| Extra Work") ||
            loopType.includes("| Re-Work") ||
            type == "Iter"
              ? null
              : Number(additionalProps.COO?.toFixed(1)),
          customfield_10076:
            loopType.includes("| Extra Work") ||
            loopType.includes("| Re-Work") ||
            type == "Iter"
              ? null
              : Number(additionalProps.DE?.toFixed(1)),
          customfield_10061:
            loopType.includes("| Extra Work") ||
            loopType.includes("| Re-Work") ||
            type == "Iter"
              ? null
              : Number(additionalProps.standard?.toFixed(1)),
          customfield_10078: additionalProps.issueKey,
          customfield_10059:
            activitySummary.includes("| 2D Drawing") ||
            activitySummary.includes("| 2D DELIVERABLES")
              ? `${additionalProps.loop}`
              : null,
          customfield_10970: additionalProps.phase,
          description: generateADF(
            activities[additionalProps.activityKey],
            productParts,
            additionalProps.phase,
          ),
          assignee: {
            id:
              additionalProps.parentIssue.fields["customfield_10045"][0][
                "accountId"
              ] || null,
          },
        });

        console.log(`Created Activity Issue: ${createdActivity.key}`);

        // Link the created Activity to the parent issue
        await linkIssues({
          inwardIssueKey: additionalProps.linkKey,
          outwardIssueKey: createdActivity.key,
          linkTypeName: "Hierarchy link (WBSGantt)",
        });
        if (type == "Iter")
          await updateOutwardIssueCount(
            additionalProps.linkKey,
            "customfield_10607",
          );

        // Create Work Order (WO) linked to the Activity
        const woSummary =
          `${additionalProps.order} | ${additionalProps.activity0} | ${additionalProps.activity1} | ${type} ${currentLoop} | WO1 ${loopType}`.trim();
        const createdWO = await createIssue({
          projectId: additionalProps.projectId,
          issueTypeId: "10009", // Replace with your Work Order issue type ID
          summary: woSummary,
          customfield_10078: additionalProps.issueKey,
          customfield_10970: additionalProps.phase,
          assignee: {
            id:
              woSummary.includes("2D Drawing") ||
              woSummary.includes("2D DELIVERABLES")
                ? additionalProps.parentIssue.fields["customfield_10079"][0][
                    "accountId"
                  ] || null
                : additionalProps.parentIssue.fields["customfield_10046"][0][
                    "accountId"
                  ] || null,
          },
        });

        console.log(`Created WO Issue: ${createdWO.key}`);

        await linkIssues({
          inwardIssueKey: createdActivity.key,
          outwardIssueKey: createdWO.key,
          linkTypeName: "Hierarchy link (WBSGantt)",
        });

        // Create Task linked to the Work Order
        const taskSummary =
          `${additionalProps.order} | ${additionalProps.activity0} | ${additionalProps.activity1} | ${type} ${currentLoop} | WO1 | Task 1 ${loopType}`.trim();
        const createdTask = await createIssue({
          projectId: additionalProps.projectId,
          issueTypeId: "10005", // Replace with your Task issue type ID
          summary: taskSummary,
          customfield_10078: additionalProps.issueKey,
          customfield_10970: additionalProps.phase,
          assignee: {
            id:
              taskSummary.includes("2D Drawing") ||
              taskSummary.includes("2D DELIVERABLES")
                ? additionalProps.parentIssue.fields["customfield_10080"][0][
                    "accountId"
                  ] || null
                : additionalProps.parentIssue.fields["customfield_10047"][0][
                    "accountId"
                  ] || null,
          },
        });

        console.log(`Created Task Issue: ${createdTask.key}`);

        await linkIssues({
          inwardIssueKey: createdWO.key,
          outwardIssueKey: createdTask.key,
          linkTypeName: "Hierarchy link (WBSGantt)",
        });

        // FIXED: Sequential delay to prevent overwhelming Jira
        await delay(1000);
      } catch (error) {
        console.error(
          `Failed to process ${loopType} activity: ${activitySummary}, Error: ${error.message}`,
        );
        continue;
      }
    }
  }

  // Main logic
  for (let [
    activityKey,
    {
      order,
      checked,
      standardLoop,
      extraWorkLoop,
      reWorkLoop,
      caeIterationLoop,
      TDL,
      COO,
      DE,
      standard,
      loop,
    },
  ] of Object.entries(activities)) {
    if (
      !checked &&
      standardLoop === 0 &&
      extraWorkLoop === 0 &&
      reWorkLoop === 0 &&
      !caeIterationLoop
    )
      continue;

    if (!order) order = "";
    const [activity0, activity1] = activityKey.split("|");

    const activityGroupSummary = `Group ${order} | ${activity0} | ${activity1}`;
    const iterationGroupSummary = "ITERATIONS | ITERATIONS";
    // Check if the specific "Activity Group" already exists
    let activityGroupIssue = existingIssues.find(
      (issue) => issue.summary === activityGroupSummary,
    );
    let iterationGroup = existingIssues.find((issue) =>
      issue.summary.includes(iterationGroupSummary),
    );
    if (!activityGroupIssue) {
      // Create "Activity Group" issue if not exists
      activityGroupIssue = await createIssue({
        projectId,
        issueTypeId: "10019", // Replace with your Activity Group issue type ID
        summary: activityGroupSummary,
        customfield_10078: issueKey,
        customfield_10061:
          standardLoop != 0 ? Number(standard?.toFixed(1)) : null,
        customfield_10970: phaseName.value,
      });
      if (activityGroupSummary.includes(iterationGroupSummary))
        iterationGroup = activityGroupIssue;
      console.log(`Created Activity Group Issue: ${activityGroupIssue.key}`);
      try {
        await linkIssues({
          inwardIssueKey: linkKey,
          outwardIssueKey: activityGroupIssue.key,
        });
      } catch (error) {
        console.error(
          `Failed to link Activity Group ${activityGroupIssue.key} to parent: ${error.message}`,
        );
        // Continue despite linking error to allow other activities to be processed
      }
    } else {
      console.log(
        `Activity Group Issue already exists: ${activityGroupIssue.key}`,
      );
      const updateResponse = await retryJiraApiCall(() =>
        api
          .asApp()
          .requestJira(route`/rest/api/3/issue/${activityGroupIssue.key}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fields: {
                customfield_10061:
                  standardLoop != 0 ? Number(standard?.toFixed(1)) : null,
              },
            }),
          }),
      );
      console.log("updated STandard at Group");
    }
    const additionalProps = {
      activityKey,

      order,
      activity0,
      activity1,
      existingIssues,
      projectId,
      TDL,
      COO,
      DE,
      standard,
      issueKey,
      parentIssue,
      // linkKey,
      linkKey: activityGroupIssue.key,
      iterationKey: caeIterationLoop ? iterationGroup.key : null,
      phase: phaseName.value,
      loop,
    };

    console.log("successs->>>>>>");

    let existingIssuesGroup = await fetchLinkedIssues(additionalProps.linkKey);
    let existingIterationIssuesGroup = caeIterationLoop
      ? await fetchLinkedIssues(additionalProps.iterationKey)
      : [];
    console.log("successs->>>>>>");

    // Filter existing issues for the current activity
    const filteredIssues = existingIssuesGroup.filter((issue) =>
      issue.summary.includes(`${activity0} | ${activity1}`),
    );
    // Calculate starting loop numbers dynamically based on filtered issues
    const totalExtraWork = filteredIssues.filter((issue) =>
      issue.summary.includes("Extra Work"),
    ).length; //1
    const totalReWork = filteredIssues.filter((issue) =>
      issue.summary.includes("Re-Work"),
    ).length; //1
    // const totalStandard = filteredIssues.filter((issue) => issue.summary.includes("Standard")).length;//1
    const totalStandard = filteredIssues.length - totalExtraWork - totalReWork; //1

    // Process Standard Loops
    await processLoops(
      "",
      totalStandard,
      standardLoop - totalStandard,
      additionalProps,
      "Loop",
    );

    // Process Extra Work Loops
    await processLoops(
      "| Extra Work",
      standardLoop + totalExtraWork + totalReWork,
      extraWorkLoop - totalExtraWork,
      additionalProps,
      "Loop",
    );

    // Process Rework Loops
    await processLoops(
      "| Re-Work",
      standardLoop +
        totalExtraWork +
        totalReWork +
        (extraWorkLoop - totalExtraWork),
      reWorkLoop - totalReWork,
      additionalProps,
      "Loop",
    );
    if (caeIterationLoop)
      await processLoops(
        "",
        0,
        caeIterationLoop,
        {
          ...additionalProps,
          linkKey: additionalProps.iterationKey,
          existingIssues: existingIterationIssuesGroup,
        },
        "Iter",
      );

    // FIXED: Sequential delay between activities
    await delay(1000);
  }

  const result = await calculateAndUpdateField(issueKey);

  return {
    success: true,
    message: `Phase "${phaseName}" created successfully with linked issues under parent issue ${issueKey}.`,
  };
});

// Resolver to return a simple message
resolver.define("getText", (req) => {
  console.log(req);
  return "Hello, world!";
});

resolver.define("projectSettingsFunction", async (req) => {
  const projectId = req.context.projectId; // Get the project ID from context

  try {
    // Fetch project details from Jira REST API
    const projectResponse = await retryJiraApiCall(() =>
      api.asApp().requestJira(route`/rest/api/3/project/${projectId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    if (!projectResponse.ok) {
      throw new Error(
        `Failed to fetch project details: ${projectResponse.status}`,
      );
    }

    const projectDetails = await projectResponse.json();

    return {
      message: `Welcome to the Project Settings Page for ${projectDetails.name}`,
      projectDetails,
    };
  } catch (error) {
    console.error(`Error fetching project details: ${error.message}`);
    throw error;
  }
});

// Key to store the product data
const STORAGE_KEY = "product-data";

// Default product data structure
const defaultProductData = {};

// Retrieve product data from Forge Storage
resolver.define("getProductData", async () => {
  let data = await storage.get(STORAGE_KEY);
  if (!data) {
    // If no data is stored, initialize with default
    data = defaultProductData;
    await storage.set(STORAGE_KEY, data);
  }
  return data;
});

// Update product data in Forge Storage
resolver.define("updateProductData", async ({ payload }) => {
  const { updatedData } = payload;
  if (!updatedData) {
    throw new Error("No data provided for update");
  }

  await storage.set(STORAGE_KEY, updatedData);
  return { success: true };
});

//////
///ProcessJSONwithPhase
//////
function processJsonWithPhase(data, phase) {
  /**
   * Processes the JSON data by multiplying the selected Phase value (Proto or Serie)
   * with TDL, COO, and DE values.
   */

  // Read JSON file

  Object.keys(data).forEach((activityKey) => {
    let activityData = data[activityKey];

    Object.keys(activityData).forEach((roof) => {
      let roofData = activityData[roof];

      if (typeof roofData === "object" && "TDL" in roofData) {
        if (
          "subactivity" in roofData &&
          Object.keys(roofData["subactivity"]).length > 0
        ) {
          // Reset roof type values and compute only from subactivities
          roofData["TDL"] = 0;
          roofData["COO"] = 0;
          roofData["DE"] = 0;

          Object.keys(roofData["subactivity"]).forEach((subactivityKey) => {
            let subData = roofData["subactivity"][subactivityKey];
            let multiplier = subData[phase] || 0;

            roofData["TDL"] += subData["TDL"] * multiplier;
            roofData["COO"] += subData["COO"] * multiplier;
            roofData["DE"] += subData["DE"] * multiplier;
          });
        } else {
          let multiplier = roofData[phase] || 0;
          data[activityKey]["loop"] = multiplier;

          roofData["TDL"] *= multiplier;
          roofData["COO"] *= multiplier;
          roofData["DE"] *= multiplier;
        }
      }
    });
  });

  // return the Phase
  return data;
}

function update2DDrawingData(data, values, product, percentages, phase) {
  for (let key in data) {
    for (let drawingKey in values) {
      // Check if the drawingData key exists in drawingDetails key
      if (key.includes(drawingKey)) {
        let value = values[drawingKey]; // Get the respective value from drawingData

        // Update NORMAL ROOF if exists
        if (data[key].hasOwnProperty(product[0])) {
          data[key][product[0]]["TDL"] = parseFloat(
            (
              (data[key][product[0]][phase] *
                value *
                percentages["TDL"] *
                (percentages[phase] / 100)) /
              100
            ).toFixed(2),
          ); // Set COO as 7.5% of DE
          data[key][product[0]]["COO"] = parseFloat(
            (
              (data[key][product[0]][phase] *
                value *
                percentages["COO"] *
                (percentages[phase] / 100)) /
              100
            ).toFixed(2),
          ); // Set COO as 7.5% of DE
          data[key][product[0]]["DE"] = parseFloat(
            (
              (data[key][product[0]][phase] *
                value *
                percentages["DE"] *
                (percentages[phase] / 100)) /
              100
            ).toFixed(2),
          ); // Set COO as 7.5% of DE
          // data[key]["2DLoop"]=data[key][product[0]][phase]
          console.log(key);
        }
      }
    }
  }
  // console.log(data)
  return data;
}

function updateDataManagement(data, values, product, percentages, phase) {
  for (let key in data) {
    // Check if the drawingData key exists in drawingDetails key
    if (
      key.includes("Customer input data management") ||
      key.includes("Data management") ||
      key.includes("Upload & Download customer data")
    ) {
      let value = values; // Get the respective value from drawingData
      console.log(value);
      // Update NORMAL ROOF if exists
      if (data[key].hasOwnProperty(product[0])) {
        data[key][product[0]]["TDL"] = parseFloat(
          (
            (data[key][product[0]][phase] *
              value *
              percentages["TDL"] *
              (percentages[phase] / 100)) /
            100
          ).toFixed(2),
        ); // Set COO as 7.5% of DE
        data[key][product[0]]["COO"] = parseFloat(
          (
            (data[key][product[0]][phase] *
              value *
              percentages["COO"] *
              (percentages[phase] / 100)) /
            100
          ).toFixed(2),
        ); // Set COO as 7.5% of DE
        data[key][product[0]]["DE"] = parseFloat(
          (
            (data[key][product[0]][phase] *
              value *
              percentages["DE"] *
              (percentages[phase] / 100)) /
            100
          ).toFixed(2),
        ); // Set COO as 7.5% of DE
        console.log(
          data[key][product[0]]["TDL"],
          data[key][product[0]]["COO"],
          data[key][product[0]]["DE"],
        );
      }
    }
  }
  return data;
}

function updateIndustrializationValues(
  json1 = {},
  json2 = {},
  detailedJson,
  percentages = {
    _3DModification: 15,
    dataManagement: 15,
    _2DModification: 15,
  },
) {
  // Summing the values of both JSON objects
  let summedJson = {};
  for (let key of new Set([
    ...Object.keys(json1 || {}),
    ...Object.keys(json2 || {}),
  ])) {
    summedJson[key] = (json1?.[key] || 0) + (json2?.[key] || 0);
  }

  // Mapping detailed JSON keys to summedJson keys
  let mappings = {
    "Industrialization | 3D modifications": "_3DModification",
    "Industrialization | Data management": "dataManagement",
    "Industrialization | 2D modifications": "_2DModification",
  };

  // Updating values in the detailed JSON
  for (let key in mappings) {
    let summedValue = summedJson[mappings[key]] || 0;
    let percentage = percentages[mappings[key]] || 0;
    let increment = parseFloat(((percentage / 100) * summedValue).toFixed(2));

    detailedJson[key].standard = increment;
    detailedJson[key].DE = increment;
    // detailedJson[key].total = increment;
  }

  return detailedJson;
}

///need to pass the phase name
/// then
resolver.define("getConfigData", async ({ payload }) => {
  let { issue, phase, key } = payload;
  console.log("fetching...");
  console.log("Key" + key, issue);

  let base64String = await storage.get(STORAGE_KEY);
  const uint8Arr = base64ToUint8Array(base64String);
  const decompressedString = pako.inflate(uint8Arr, { to: "string" });
  let data = JSON.parse(decompressedString);
  let updatedActivities = {};
  if (key == "Activity") {
    // let storedActivity=await storage.get(issue.key)
    // if(storedActivity) return storedActivity
    const issueDetail = await fetchIssue(issue.key);
    // console.log(issueDetail)
    key = issueDetail.fields["customfield_10073"].value;
    // let customer = issueDetail.fields["customfield_10041"]
    let customer = issueDetail.fields["customfield_10838"].value;

    const productParts = issueDetail.fields["customfield_10074"].map(
      (element) => element.value,
    );
    // console.log(productParts)
    console.log("Key" + key);
    // data=processJsonWithPhase(data,phase)
    console.log("Phasessss" + phase);

    if (!key.includes("- CAE")) {
      updatedActivities = calculateSumsWithTotal(
        processJsonWithPhase(data[key].activities, phase),
        productParts,
      );
      console.log(updatedActivities);
      let _2DDrawing = data["2D Drawing"].activities[key];
      let _2DDrawingPercentages = data["2D Drawing"].percentages;
      updatedActivities = calculateSumsWithTotal(
        update2DDrawingData(
          data[key].activities,
          _2DDrawing,
          productParts,
          _2DDrawingPercentages,
          phase,
        ),
        productParts,
      );
      let _dataManagementTime =
        data["Data Management"].customers[key][customer] ||
        data["Data Management"].customers[key]["Standard"];
      let _dataManagementPercentages = data["Data Management"].percentages;
      updatedActivities = calculateSumsWithTotal(
        updateDataManagement(
          data[key].activities,
          _dataManagementTime,
          productParts,
          _dataManagementPercentages,
          phase,
        ),
        productParts,
      );

      // console.log("_2DDrawing", JSON.stringify(_2DDrawing))
      if (phase == "Industrialization") {
        let proto = await storage.get(`${issue.key}_Industrialization_Proto`);
        let serie = await storage.get(`${issue.key}_Industrialization_Serie`);
        updatedActivities = updateIndustrializationValues(
          proto,
          serie,
          data["Industrialization"].activities,
          data["Industrialization"].percentages[key],
        );
      }
    } else {
      updatedActivities = data[key].activities;
    }

    console.log(updatedActivities);

    // console.log(JSON.stringify(updatedActivities))
  }
  // console.log(data)
  if (data) {
    // console.log(key == "Milestone" ? data[key].milestones : updatedActivities)
    return key == "Milestone" && phase != "Industrialization"
      ? data[key].milestones
      : { product: key, activity: updatedActivities };
  }
  return {};
});

///////////////////////////////////////////////////
// Listener
///////////////////////////////////////////////////

// Fetch parent issue ID
async function fetchParentIssueId(issueId) {
  const issueResponse = await retryJiraApiCall(() =>
    api.asApp().requestJira(route`/rest/api/3/issue/${issueId}`),
  );
  const issueData = await issueResponse.json();

  const inwardLinks = issueData.fields.issuelinks.filter(
    (link) =>
      link.type.name === "Hierarchy link (WBSGantt)" && link.inwardIssue,
  );

  if (inwardLinks.length > 0) {
    return inwardLinks[0].inwardIssue.id;
  } else {
    console.log(`No parent issue (inward link) found for issue: ${issueId}`);
    return null;
  }
}

// Recursive function to propagate updates up the hierarchy
async function propagateActivityHours(currentIssueId, customFieldKey) {
  try {
    // Fetch the current issue details
    const response = await retryJiraApiCall(() =>
      api.asApp().requestJira(route`/rest/api/3/issue/${currentIssueId}`),
    );
    const issueData = await response.json();

    // Find inward issues linked with "Hierarchy link (WBSGantt)"
    const inwardLinks = issueData.fields.issuelinks.filter(
      (link) =>
        link.type.name === "Hierarchy link (WBSGantt)" && link.inwardIssue,
    );

    // Fetch all outward (child) issues for the current issue
    const outwardLinks = issueData.fields.issuelinks.filter(
      (link) =>
        link.type.name === "Hierarchy link (WBSGantt)" && link.outwardIssue,
    );
    const childIssueIds = outwardLinks.map((link) => link.outwardIssue.id);

    // Sum all custom field values under child issues
    let totalLoggedHours = 0;
    for (const childId of childIssueIds) {
      const childIssueResponse = await retryJiraApiCall(() =>
        api.asApp().requestJira(route`/rest/api/3/issue/${childId}`),
      );
      const childIssueData = await childIssueResponse.json();
      const childHours = childIssueData.fields[customFieldKey] || 0;
      totalLoggedHours += childHours;
    }

    // Update the custom field for the current issue
    // totalLoggedHours=issueData.fields.status.name=="Closed" && customFieldKey=="customfield_10093"?totalLoggedHours:null;
    // totalLoggedHours = customFieldKey == "customfield_10093" ? (issueData.fields.status.name == "Closed" ? totalLoggedHours : null) : totalLoggedHours;

    const updateResponse = await retryJiraApiCall(() =>
      api.asApp().requestJira(route`/rest/api/3/issue/${currentIssueId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            [customFieldKey]: Number(totalLoggedHours?.toFixed(1)) || null,
          },
        }),
      }),
    );

    if (updateResponse.ok) {
      console.log(
        `Successfully propagated field ${customFieldKey} for issue: ${currentIssueId}`,
      );
    } else {
      console.error(
        `Failed to propagate field ${customFieldKey}: ${await updateResponse.text()}`,
      );
    }

    // Recur for the parent (inward issue)
    if (inwardLinks.length > 0) {
      const parentIssueId = inwardLinks[0].inwardIssue.id;
      console.log(`Propagating to parent issue: ${parentIssueId}`);
      await propagateActivityHours(parentIssueId, customFieldKey);
    }
  } catch (error) {
    console.error(`Error propagating for issue ${currentIssueId}:`, error);
  }
}
// Recursive function to propagate updates up the hierarchy
async function propagateIterCount(currentIssueId, customFieldKey) {
  try {
    // Fetch the current issue details
    const response = await retryJiraApiCall(() =>
      api.asApp().requestJira(route`/rest/api/3/issue/${currentIssueId}`),
    );
    const issueData = await response.json();

    // Find inward issues linked with "Hierarchy link (WBSGantt)"
    const inwardLinks = issueData.fields.issuelinks.filter(
      (link) =>
        link.type.name === "Hierarchy link (WBSGantt)" && link.inwardIssue,
    );

    // Fetch all outward (child) issues for the current issue
    const outwardLinks = issueData.fields.issuelinks.filter(
      (link) =>
        link.type.name === "Hierarchy link (WBSGantt)" && link.outwardIssue,
    );
    const childIssueIds = outwardLinks.map((link) => link.outwardIssue.id);

    // Sum all custom field values under child issues
    let totalLoggedHours = 0;
    for (const childId of childIssueIds) {
      const childIssueResponse = await retryJiraApiCall(() =>
        api.asApp().requestJira(route`/rest/api/3/issue/${childId}`),
      );
      const childIssueData = await childIssueResponse.json();
      const childHours = !childIssueData.fields["summary"].includes("ITERATION")
        ? childIssueData.fields[customFieldKey]
        : 0 || 0;
      totalLoggedHours += childHours;
    }

    // Update the custom field for the current issue
    // totalLoggedHours=issueData.fields.status.name=="Closed" && customFieldKey=="customfield_10093"?totalLoggedHours:null;
    // totalLoggedHours = customFieldKey == "customfield_10093" ? (issueData.fields.status.name == "Closed" ? totalLoggedHours : null) : totalLoggedHours;

    const updateResponse = await retryJiraApiCall(() =>
      api.asApp().requestJira(route`/rest/api/3/issue/${currentIssueId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            [customFieldKey]: Number(totalLoggedHours?.toFixed(1)) || null,
          },
        }),
      }),
    );

    if (updateResponse.ok) {
      console.log(
        `Successfully propagated field ${customFieldKey} for issue: ${currentIssueId}`,
      );
    } else {
      console.error(
        `Failed to propagate field ${customFieldKey}: ${await updateResponse.text()}`,
      );
    }

    // Recur for the parent (inward issue)
    if (inwardLinks.length > 0) {
      const parentIssueId = inwardLinks[0].inwardIssue.id;
      console.log(`Propagating to parent issue: ${parentIssueId}`);
      await propagateIterCount(parentIssueId, customFieldKey);
    }
  } catch (error) {
    console.error(`Error propagating for issue ${currentIssueId}:`, error);
  }
}

async function propagateActivityHoursBulk(currentIssueId, customFieldKeys) {
  try {
    // Fetch the current issue details
    const response = await retryJiraApiCall(() =>
      api.asApp().requestJira(route`/rest/api/3/issue/${currentIssueId}`),
    );
    const issueData = await response.json();

    // Find inward (parent) and outward (child) issues linked with "Hierarchy link (WBSGantt)"
    const inwardLinks = issueData.fields.issuelinks.filter(
      (link) =>
        link.type.name === "Hierarchy link (WBSGantt)" && link.inwardIssue,
    );
    const outwardLinks = issueData.fields.issuelinks.filter(
      (link) =>
        link.type.name === "Hierarchy link (WBSGantt)" && link.outwardIssue,
    );
    const childIssueIds = outwardLinks.map((link) => link.outwardIssue.id);

    // Initialize an object to store total values for all fields
    const totalValues = {};
    for (const key of customFieldKeys) {
      totalValues[key] = 0;
    }

    // Fetch and sum all custom field values under child issues
    for (const childId of childIssueIds) {
      const childIssueResponse = await retryJiraApiCall(() =>
        api.asApp().requestJira(route`/rest/api/3/issue/${childId}`),
      );
      const childIssueData = await childIssueResponse.json();

      for (const key of customFieldKeys) {
        totalValues[key] += childIssueData.fields[key] || 0;
      }
    }

    // Prepare update payload
    const fieldsToUpdate = {};
    for (const key of customFieldKeys) {
      fieldsToUpdate[key] = Number(totalValues[key]?.toFixed(1)) || null;
    }

    // Update the custom fields for the current issue
    const updateResponse = await retryJiraApiCall(() =>
      api.asApp().requestJira(route`/rest/api/3/issue/${currentIssueId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fieldsToUpdate }),
      }),
    );

    if (updateResponse.ok) {
      console.log(
        `Successfully propagated fields ${customFieldKeys} for issue: ${currentIssueId}`,
      );
    } else {
      console.error(
        `Failed to propagate fields: ${await updateResponse.text()}`,
      );
    }

    // Recur for the parent (inward issue)
    if (inwardLinks.length > 0) {
      const parentIssueId = inwardLinks[0].inwardIssue.id;
      console.log(`Propagating to parent issue: ${parentIssueId}`);
      await propagateActivityHoursBulk(parentIssueId, customFieldKeys);
    }
  } catch (error) {
    console.error(`Error propagating for issue ${currentIssueId}:`, error);
  }
}

// async function delay(ms) {
//   return new Promise(resolve => setTimeout(resolve, ms));
// }

export async function enqueueUpdateLog(event, context) {
  console.log("Logged");
  // console.log(event);
  const currentIssueId = await event.worklog.issueId;
  console.log(currentIssueId);
  const issueResponse = await retryJiraApiCall(() =>
    api.asApp().requestJira(route`/rest/api/3/issue/${currentIssueId}`),
  );
  const issueData = await issueResponse.json();
  const projectKey = await issueData.fields.project.key;

  console.log(projectKey);

  if (projectKey === "CTEST") {
    // Dev --> CDEMO // Prod --> CWO // Stage --> CTEST
    let retryCount = 0;
    let success = false;

    while (!success && retryCount < 5) {
      try {
        console.log(
          `🚀 Attempting to enqueue Log update (Try ${retryCount + 1})`,
          event,
        );
        // console.log('🚀 Enqueuing KPI update:', event);
        await updateLogQueue.push(event, context);
        console.log("✅ Successfully enqueued Log update");
        success = true; // Exit loop on success
      } catch (error) {
        // console.error('❌ Error enqueuing KPI update:', error);
        if (error.name === "RateLimitError") {
          console.warn(
            `⚠️ Rate limit reached. Retrying in ${2 ** retryCount} seconds...`,
          );
          await delay(2 ** retryCount * 1000); // Exponential backoff
          retryCount++;
        } else {
          console.error("❌ Error enqueuing Log update:", error);
          break; // Break the loop for non-rate-limit errors
        }
      }
    }
    if (!success) {
      console.error("❌ Failed to enqueue Log update after multiple retries");
    }
  } else {
    console.log("Skip Worklog");
  }
}
export async function updateLog(event, context) {
  let retryCount = 0;
  let success = false;

  while (!success && retryCount < 10) {
    try {
      console.log("Worklog Event:", JSON.stringify(event));

      const issueId = event.call.payload.worklog.issueId; // Current issue ID
      const worklogId = event.call.payload.worklog.id; // Worklog ID
      const customFieldDE = "customfield_10081"; // DE Actual / DE Activity hours
      const customFieldCOO = "customfield_10082"; // COO Act Hours

      const customFieldTDL = "customfield_10083"; // Tdl Act Hrs
      const customFieldExtraWork = "customfield_10084"; // Extra Work
      const customFieldRework = "customfield_10085"; // Rework
      console.log(issueId);

      try {
        // Step 1: Fetch the current issue
        const issueResponse = await retryJiraApiCall(() =>
          api.asApp().requestJira(route`/rest/api/3/issue/${issueId}`),
        );
        const issueData = await issueResponse.json();
        const issueType = issueData.fields.issuetype.name;
        const summary = issueData.fields.summary;

        // Check for [Extra Work] and [Re-Work] in the summary
        const isExtraWork = summary.includes("Extra Work");
        const isRework = summary.includes("Re-Work");

        // Determine the action based on the issue type
        if (issueType === "Task") {
          await handleTaskUpdate(issueId, isExtraWork, isRework);
        } else if (issueType === "Work Order") {
          await handleWorkOrderUpdate(issueId);
        } else if (issueType === "Activity" || issueType === "Activity Group") {
          await handleActivityUpdate(issueId);
        } else {
          console.log(
            `Skipping issue as it's not a relevant type: ${issueType}`,
          );
        }
      } catch (error) {
        console.error("Error processing worklog event:", error);
      }

      // Function to handle Task updates
      async function handleTaskUpdate(issueId, isExtraWork, isRework) {
        console.log(`Handling Task update for issue: ${issueId}`);
        await updateWorklogHours(issueId, customFieldDE);

        // if (isExtraWork) {
        //   console.log(`[Extra Work] detected in summary for Task: ${issueId}`);
        //   await updateWorklogHours(issueId, customFieldExtraWork);
        // }

        // if (isRework) {
        //   console.log(`[Re-Work] detected in summary for Task: ${issueId}`);
        //   await updateWorklogHours(issueId, customFieldRework);
        // }

        const parentIssueId = await fetchParentIssueId(issueId);
        if (parentIssueId) {
          await propagateActivityHours(parentIssueId, customFieldDE);
          if (isExtraWork)
            await propagateActivityHours(parentIssueId, customFieldExtraWork);
          if (isRework)
            await propagateActivityHours(parentIssueId, customFieldRework);
        }
      }

      // Function to handle Work Order updates
      async function handleWorkOrderUpdate(issueId) {
        console.log(`Handling Work Order update for issue: ${issueId}`);
        await updateWorklogHours(issueId, customFieldCOO);
        const parentIssueId = await fetchParentIssueId(issueId);
        if (parentIssueId)
          await propagateActivityHours(parentIssueId, customFieldCOO);
      }

      // Function to handle Activity updates
      async function handleActivityUpdate(issueId) {
        console.log(`Handling Activity update for issue: ${issueId}`);
        await updateWorklogHours(issueId, customFieldTDL);
        const parentIssueId = await fetchParentIssueId(issueId);
        if (parentIssueId)
          await propagateActivityHours(parentIssueId, customFieldTDL);
      }

      // Update worklog hours for the current issue
      async function updateWorklogHours(issueId, customFieldKey) {
        const worklogResponse = await retryJiraApiCall(() =>
          api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/worklog`),
        );
        const worklogData = await worklogResponse.json();

        const totalWorkloggedHours = worklogData.worklogs.reduce(
          (sum, worklog) => sum + worklog.timeSpentSeconds / 3600,
          0,
        );

        const updateResponse = await retryJiraApiCall(() =>
          api.asApp().requestJira(route`/rest/api/3/issue/${issueId}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fields: {
                [customFieldKey]:
                  Number(totalWorkloggedHours?.toFixed(1)) || null,
              },
            }),
          }),
        );

        if (updateResponse.ok) {
          console.log(
            `Successfully updated field ${customFieldKey} for issue: ${issueId}`,
          );
        } else {
          console.error(
            `Failed to update field ${customFieldKey}: ${await updateResponse.text()}`,
          );
        }
      }

      success = true;
    } catch (error) {
      if (error.name === "RateLimitError") {
        console.warn(
          `⚠️ Rate limit reached. Retrying in ${2 ** retryCount} seconds...`,
        );
        await delay(2 ** retryCount * 1000); // Exponential backoff
        retryCount++;
      } else {
        console.error("❌ Error processing Log update:", error);
        break; // Break the loop for non-rate-limit errors
      }
    }
  }
  if (!success) {
    console.error("❌ Failed to process Log update after multiple retries");
  }
}

// function dateDifference(date1, date2) {
//   // Helper function to parse and strip time from a date
//   function getDateOnly(inputDate) {
//     if (!inputDate) {
//       return new Date().setHours(0, 0, 0, 0); // Use today's date with time stripped
//     }
//     const parsedDate = new Date(inputDate);
//     return parsedDate.setHours(0, 0, 0, 0); // Strip time
//   }

//   // Get both dates as timestamp (ignoring time part)
//   const firstDate = getDateOnly(date1);
//   const secondDate = getDateOnly(date2);

//   // Calculate the difference in milliseconds
//   const diffInMs = Math.abs(firstDate - secondDate);

//   // Convert milliseconds to days
//   const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

//   return diffInDays;
// }

// function dateDifference(date1, date2) {
//   // Helper function to parse and strip time from a date
//   function getDateOnly(inputDate) {
//     if (!inputDate) {
//       return new Date(new Date().setHours(0, 0, 0, 0)); // Use today's date with time stripped
//     }
//     const parsedDate = new Date(inputDate);
//     parsedDate.setHours(0, 0, 0, 0); // Strip time
//     return parsedDate; // Return as Date object
//   }

//   // Get both dates as Date objects (ignoring time part)
//   let firstDate = getDateOnly(date1);
//   let secondDate = getDateOnly(date2);

//   // Ensure the start date is the earlier one
//   let start = firstDate < secondDate ? firstDate : secondDate;
//   let end = firstDate > secondDate ? firstDate : secondDate;
//   let count = 0;

//   // Iterate through each day and count only working days (Monday-Friday)
//   while (start <= end) {
//     let day = start.getDay();
//     if (day >= 1 && day <= 5) { // Monday (1) to Friday (5)
//       count++;
//     }
//     start.setDate(start.getDate() + 1);
//   }

//   return count;
// }
// function dateDifference(date1, date2) {
//   function getDateOnly(inputDate) {
//     if (!inputDate) {
//       return new Date(new Date().setHours(0, 0, 0, 0));
//     }
//     let parsedDate = new Date(inputDate.replace(/(\+\d{4})$/, ''));
//     if (isNaN(parsedDate.getTime())) {
//       return null; // Invalid date handling
//     }
//     parsedDate.setHours(0, 0, 0, 0);
//     return parsedDate;
//   }

//   let firstDate = getDateOnly(date1);
//   let secondDate = getDateOnly(date2);
//   if (!firstDate || !secondDate) return null;

//   let start = firstDate < secondDate ? firstDate : secondDate;
//   let end = firstDate > secondDate ? firstDate : secondDate;
//   let count = 0;
//   let tempDate = new Date(start);

//   while (tempDate <= end) {
//     let day = tempDate.getDay();
//     if (day >= 1 && day <= 5) {
//       count++;
//     }
//     tempDate.setDate(tempDate.getDate() + 1);
//   }

//   return count;
// }

function dateDifference(U, V, W, mode = "start") {
  function getDateOnly(inputDate) {
    if (!inputDate) {
      return new Date(new Date().setHours(0, 0, 0, 0));
    }
    let parsedDate = new Date(inputDate.replace(/(\+\d{4})$/, ""));
    if (isNaN(parsedDate.getTime())) {
      return null;
    }
    parsedDate.setHours(0, 0, 0, 0);
    return parsedDate;
  }

  const dateU = getDateOnly(U);
  const dateV = getDateOnly(V);
  const dateW = W ? getDateOnly(W) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!dateU || !dateV) return null;

  let endDate;

  if (W && dateW) {
    endDate = mode === "start" ? dateV : dateW;
  } else if (dateV < today) {
    endDate = mode === "start" ? dateV : today;
  } else {
    return 0;
  }

  let start = dateU < endDate ? dateU : endDate;
  let end = dateU > endDate ? dateU : endDate;
  let count = 0;
  let tempDate = new Date(start);

  while (tempDate <= end) {
    let day = tempDate.getDay();
    if (day >= 1 && day <= 5) {
      count++;
    }
    tempDate.setDate(tempDate.getDate() + 1);
  }

  return count;
}

export async function enqueueUpdateKPI(event, context) {
  let retryCount = 0;
  let success = false;
  const maxRetries = 5;
  const baseDelayMs = 60000; // 60 seconds base delay

  while (!success && retryCount < maxRetries) {
    try {
      console.log(
        `🚀 Attempting to enqueue KPI update (Try ${retryCount + 1}/${maxRetries})`,
        {
          issueId: event?.call?.payload?.issue?.id || "unknown",
          retryCount,
        },
      );

      await updateKPIQueue.push(event, context);

      console.log("✅ Successfully enqueued KPI update");
      success = true; // Exit loop on success
    } catch (error) {
      console.error("❌ Error enqueuing KPI update:", {
        error: error.message,
        errorName: error.name,
        retryCount: retryCount + 1,
        maxRetries,
      });

      // Check if it's a rate limit error or similar retryable error
      const isRetryableError =
        error.name === "RateLimitError" ||
        error.message?.includes("Too many requests") ||
        error.message?.includes("rate limit") ||
        error.name === "TimeoutError" ||
        error.message?.includes("timeout");

      if (isRetryableError && retryCount < maxRetries - 1) {
        // Calculate delay between 60-180 seconds with jitter
        const minDelay = 60000; // 60 seconds
        const maxDelay = 120000; // 180 seconds
        const randomDelay = Math.random() * (maxDelay - minDelay) + minDelay;
        const delayMs = Math.round(randomDelay);

        console.warn(
          `⚠️ Rate limit/timeout reached. Retrying in ${Math.round(delayMs / 1000)}s... (${retryCount + 1}/${maxRetries - 1})`,
        );

        retryCount++;
        await delay(delayMs);
      } else {
        // Non-retryable error or max retries reached
        if (retryCount >= maxRetries - 1) {
          console.error(
            `❌ Max retries (${maxRetries}) reached for KPI update`,
          );
        } else {
          console.error("❌ Non-retryable error for KPI update:", error.name);
        }
        break; // Break the loop for non-retryable errors or max retries
      }
    }
  }

  if (!success) {
    console.error("❌ Failed to enqueue KPI update after multiple retries", {
      finalRetryCount: retryCount,
      maxRetries,
      issueId: event?.call?.payload?.issue?.id || "unknown",
    });
  }
}

export async function updateKPI(event, context) {
  let retryCount = 0;
  let success = false;

  while (!success && retryCount < 10) {
    try {
      console.log("Event Triggered:", JSON.stringify(event));

      const issueId = event.call.payload.issue.id; // The issue that triggered the event
      // const customField10065 = 'customfield_10065'; //Actual Hours
      // const customField10065 = 'customfield_10065'; //Actual Hours
      const customField10085 = "customfield_10085"; //Rework
      const customField10084 = "customfield_10084"; //Extra Work

      const customField10083 = "customfield_10083"; //
      const customField10082 = "customfield_10082"; //
      const customField10081 = "customfield_10081"; //DE Act Hours
      const customField10086 = "customfield_10086"; //Rework (Rework Ratio)
      const customField10070 = "customfield_10070"; //EWR
      const customField10066 = "customfield_10066"; //DFS
      const customField10065 = "customfield_10065"; //Actual Hours
      const customField10061 = "customfield_10061"; //Standard Hours
      const customField10100 = "customfield_10100"; //WO-FTR (Without Rejection)
      const customField10101 = "customfield_10101"; //FTR (Without Rejection)
      const customField10078 = "customfield_10078"; //Project Key
      const customField10056 = "customfield_10056"; //Task Estimation
      const customField10092 = "customfield_10092"; //DED Calc1
      const customField10093 = "customfield_10093"; //DFS Act Hrs
      const customField10015 = "customfield_10015"; //Start Date
      const customField10053 = "customfield_10053"; //End Date
      const customField10009 = "customfield_10009"; //Actual End
      const customField10094 = "customfield_10094"; //Activity OTD (On time Delivery)
      const customField10095 = "customfield_10095"; //Activity Plan OTD (On time Delivery)
      const customField10096 = "customfield_10096"; //Actual End
      const customField10068 = "customfield_10068"; //DED % (Designer Engg Deviation)

      const customField10039 = "customfield_10039";
      const customField10050 = "customfield_10050";
      const customField10073 = "customfield_10073"; //Product BU
      const customField10839 = "customfield_10839";
      const customField10871 = "customfield_10871";
      const customField10872 = "customfield_10872";
      const customField10971 = "customfield_10971"; // Close Std Hrs
      const customField10972 = "customfield_10972"; // Close DE Hrs
      const customField10075 = "customfield_10075";
      const customField10076 = "customfield_10076";
      const customField10077 = "customfield_10077";
      const customField11036 = "customfield_11036"; //Iter Std Act Hour

      const customField11003 = "customfield_11003"; //Iter Act Hour
      const customField10970 = "customfield_10970"; //Phase

      const customField10607 = "customfield_10607"; //Iter count

      try {
        // Step 1: Fetch the current issue
        const issueResponse = await api
          .asApp()
          .requestJira(route`/rest/api/3/issue/${issueId}`);
        const issueData = await issueResponse.json();
        const type = issueData.fields.issuetype.name;
        const issueStatus = issueData.fields.status.name;
        console.log("Statuss --> ", issueStatus);
        console.log(issueData.fields[customField10078]);
        // Step 2: Retrieve the values of the fields
        const fieldValue10085 = issueData.fields[customField10085] || 0; // Default to 0 if null
        const fieldValue10084 = issueData.fields[customField10084] || 0; // Default to 0 if null
        const fieldValue10083 = issueData.fields[customField10083] || 0; // Default to 0 if null
        const fieldValue10082 = issueData.fields[customField10082] || 0; // Default to 0 if null
        const fieldValue10081 = issueData.fields[customField10081] || 0; // Default to 0 if null
        const fieldValue10061 = issueData.fields[customField10061] || 0; // Default to 0 if null
        const fieldValue10078 = issueData.fields[customField10078] || 0; // Default to 0 if null
        const fieldValue10056 = issueData.fields[customField10056] || 0; // Default to 0 if null
        const fieldValue10015 = issueData.fields[customField10015]; // Default to 0 if null
        const fieldValue10053 = issueData.fields[customField10053]; // Default to 0 if null
        const fieldValue10009 = issueData.fields[customField10009]; // Default to 0 if null
        const fieldValue10092 = issueData.fields[customField10092] || 0; // Default to 0 if null
        const fieldValue10094 = issueData.fields[customField10094] || 0; // Default to 0 if null
        const fieldValue10095 = issueData.fields[customField10095] || 0; // Default to 0 if null
        const fieldValue10093 = issueData.fields[customField10093] || 0; // Default to 0 if null
        const fieldValue10971 = issueData.fields[customField10971] || 0; // Default to 0 if null
        const fieldValue10972 = issueData.fields[customField10972] || 0; // Default to 0 if null
        const fieldValue11036 = issueData.fields[customField11036] || 0; // Default to 0 if null
        const fieldValue11003 = issueData.fields[customField11003] || 0; // Default to 0 if null

        async function getReportingManagerByAssignee(assignee) {
          if (assignee) {
            let base64String = await storage.get(STORAGE_KEY);
            const uint8Arr = base64ToUint8Array(base64String);
            const decompressedString = pako.inflate(uint8Arr, { to: "string" });
            let data = JSON.parse(decompressedString);
            const reporter =
              data["Reporting Manager"]["users"][assignee.accountId];
            return reporter ? reporter : null; // Returns the first matched user
          }
        }

        function extractBetweenFirstAndThird(input) {
          const parts = input.split("|"); // Split by " | "

          if (parts.length < 4) return null; // Ensure at least 3 separators exist

          return parts.slice(1, 3).join("|"); // Extract between first and third "|"
        }

        console.log(fieldValue10015, fieldValue10053, fieldValue10009);
        if (["Activity", "Work Order", "Task"].includes(type)) {
          console.log(type);
          const projectDetails = await api
            .asApp()
            .requestJira(route`/rest/api/3/issue/${fieldValue10078}`);
          const projectData = await projectDetails.json();
          console.log(projectData);
          console.log(
            issueData.fields.assignee
              ? {
                  id: await getReportingManagerByAssignee(
                    issueData.fields.assignee,
                  ),
                }
              : null,
          );
          console.log(
            await getReportingManagerByAssignee(issueData.fields.assignee),
          );
          const updateResponse = await api
            .asApp()
            .requestJira(route`/rest/api/3/issue/${issueId}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                fields: {
                  [customField10039]: projectData.fields["summary"],
                  [customField10050]: projectData.fields[customField10050],
                  [customField10073]: projectData.fields[customField10073],
                  [customField10839]: projectData.fields[customField10839],
                  [customField10871]: extractBetweenFirstAndThird(
                    issueData.fields.summary,
                  ),
                  [customField10872]: issueData.fields.assignee
                    ? {
                        id: await getReportingManagerByAssignee(
                          issueData.fields.assignee,
                        ),
                      }
                    : null,
                },
              }),
            });
        }
        // console.log(xyz)
        // console.log(`Field Values:
        //   customfield_10083: ${fieldValue10083},
        //   customfield_10082: ${fieldValue10082},
        //   customfield_10081: ${fieldValue10081}`);
        //propageate Standard Hours

        // propagateActivityHours(issueId,customField10061)

        // Step 3: Calculate the sum
        const fieldValue10065 =
          fieldValue10083 + fieldValue10082 + fieldValue10081;
        let DFSValue = null;
        // console.log(`Actual Hours (Sum): ${fieldValue10065}`);
        if (["Project", "Phase", "Activity", "Activity Group"].includes(type)) {
          if (
            !(
              issueData.fields.summary.includes("Extra Work") ||
              issueData.fields.summary.includes("Re-Work")
            )
          )
            DFSValue =
              fieldValue10093 != 0
                ? ((fieldValue10093 - fieldValue10971) / fieldValue10971) * 100
                : null;

          if (fieldValue10093 === fieldValue10971) {
            console.log("Updating DFS to 0");
            DFSValue = 0;
          }
          console.log("KPI - ", type, DFSValue);
        }

        if (["Activity"].includes(type)) {
          if (issueStatus === "Closed") {
            DFSValue = Number(DFSValue?.toFixed(1)) ?? 0;
          } else {
            DFSValue = null;
          }
          console.log("CASE 1---> Type: ", type, "--- Value:", DFSValue);
        } else if (["Activity Group", "Project", "Phase"].includes(type)) {
          const oldValue = DFSValue;

          DFSValue =
            fieldValue10093 != 0 && fieldValue10093 === fieldValue10971
              ? 0
              : (Number(DFSValue?.toFixed(1)) ?? null);

          if (
            (fieldValue10093 === 0 && fieldValue10971 === 0) ||
            (fieldValue10093 === null && fieldValue10971 === null)
          ) {
            DFSValue = null;
            console.log(
              "CASE 2.1---> Type: ",
              type,
              "-- Old Value : ",
              oldValue,
              " | --- Value:",
              DFSValue,
              " && Date fields = ",
              fieldValue10093,
              " & ",
              fieldValue10971,
            );
          }
          console.log(
            "CASE 2---> Type: ",
            type,
            "-- Old Value : ",
            oldValue,
            " | --- Value:",
            DFSValue,
            " && Date fields = ",
            fieldValue10093,
            " & ",
            fieldValue10971,
          );
        } else {
          DFSValue = null;
          console.log("CASE 3---> Type: ", type, "--- Value:", DFSValue);
        }

        console.log("DFS VAlue", type, DFSValue);

        let extraWorkValue = null;
        let reWorkValue = null;

        // if (["Project"].includes(type)) {
        //   extraWorkValue = (fieldValue10084 / fieldValue10065) * 100;
        //   reWorkValue = (fieldValue10085 / fieldValue10065) * 100;
        // }
        if (["Project", "Phase", "Activity Group"].includes(type)) {
          extraWorkValue = (fieldValue10084 / fieldValue10065) * 100;
          reWorkValue = (fieldValue10085 / fieldValue10065) * 100;
        }

        // Check for [Extra Work] and [Re-Work] in the summary
        const isExtraWork = issueData.fields.summary.includes("Extra Work");
        const isRework = issueData.fields.summary.includes("Re-Work");

        // Step 4: Update the KPI field (customfield_10065)
        const updateResponse = await api
          .asApp()
          .requestJira(route`/rest/api/3/issue/${issueId}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fields: {
                [customField10065]: Number(fieldValue10065?.toFixed(1)) || null,
                // [customField10066]: ["Activity", "Activity Group"].includes(type) ? (issueStatus === "Closed" ? (Number(DFSValue ?.toFixed(1)) || 0) : null ) : null,   // changed from null to 0
                [customField10066]: DFSValue,
                [customField10086]: Number(reWorkValue?.toFixed(1)) || null,
                [customField10070]: Number(extraWorkValue?.toFixed(1)) || null,
                [customField10068]: Number(
                  (
                    ((fieldValue10972 - fieldValue10092) / fieldValue10092) *
                    100
                  )?.toFixed(1),
                ), //calculate proper
                [customField10084]: isExtraWork
                  ? Number(fieldValue10065?.toFixed(1)) || null
                  : fieldValue10084 || null,
                [customField10085]: isRework
                  ? Number(fieldValue10065?.toFixed(1)) || null
                  : fieldValue10085 || null,
              },
            }),
          });

        const parentIssueId = await fetchParentIssueId(issueId);
        if (parentIssueId) {
          const array = [
            "Project",
            "Phase",
            "Activity Group",
            "Activity",
          ].includes(type)
            ? [
                customField10084,
                customField10085,
                customField10056,
                customField10075,
                customField10076,
                customField10077,
              ]
            : [customField10084, customField10085, customField10056];
          await propagateActivityHoursBulk(parentIssueId, array);
          if (type == "Activity Group") {
            await propagateActivityHoursBulk(parentIssueId, [
              customField11003,
              customField11036,
            ]);
            await propagateIterCount(parentIssueId, [customField10607]);
          }
          // await propagateActivityHours(parentIssueId, customField10084);,
          // await propagateActivityHours(parentIssueId, customField10085);
        }

        if (updateResponse.ok) {
          console.log(
            `Successfully updated customfield_10065 with value: ${fieldValue10065}`,
          );
        } else {
          console.error(
            `Failed to update customfield_10065: ${await updateResponse.text()}`,
          );
        }

        ///////////
        // Done till here
        ///////////

        console.log(type, type != "Project");
        console.log(fieldValue10078);
        if (
          ["Phase", "Activity Group", "Activity", "Work Order"].includes(type)
        ) {
          async function fetchInwardLinkedIssues(issueKey) {
            const response = await api
              .asApp()
              .requestJira(
                route`/rest/api/3/issue/${issueKey}?fields=issuelinks`,
              );
            const issue = await response.json();

            return issue.fields.issuelinks
              .filter(
                (link) =>
                  link.type.name === "Hierarchy link (WBSGantt)" &&
                  link.inwardIssue,
              )
              .map((link) => link.inwardIssue.key);
          }

          async function fetchAllWorkOrders(issueKey) {
            const workOrders = new Set();

            async function traverse(key) {
              const res = await api
                .asApp()
                .requestJira(
                  route`/rest/api/3/issue/${key}?fields=issuetype,issuelinks,status`,
                );

              const issue = await res.json();
              console.log(
                `/rest/api/3/issue/${key}?fields=issuetype,issuelinks`,
              );
              if (
                issue.fields.issuetype.name === "Work Order" &&
                issue.fields.status.id !== "10006"
              ) {
                workOrders.add(issue.key);
                return;
              }

              const linkedIssues = issue.fields.issuelinks
                .filter(
                  (link) =>
                    link.type.name === "Hierarchy link (WBSGantt)" &&
                    link.outwardIssue,
                )
                .map((link) => link.outwardIssue.key);

              for (const linkedKey of linkedIssues) {
                await traverse(linkedKey);
              }
            }

            await traverse(issueKey);
            return Array.from(workOrders);
          }
          async function generateWorkOrderJQL(workOrders) {
            // const workOrders = await fetchAllWorkOrders(issueKey);
            if (workOrders.length === 0) {
              return "key in (EMPTY)";
            }
            const jql = `key in (${workOrders.join(",")}) AND "WO-FTR (Without Rejection)[Number]" IS NOT EMPTY`;
            return jql;
          }
          let updateKey = await fetchInwardLinkedIssues(issueData.key);
          console.log("fetch--->", updateKey);
          const workOrders = await fetchAllWorkOrders(updateKey);

          const jql = await generateWorkOrderJQL(workOrders);
          console.log(jql);

          // const jql = `"Project Key[Short text]" ~ "${fieldValue10078}" AND "WO-FTR (Without Rejection)[Number]" IS NOT EMPTY`;
          // console.log(jql)
          try {
            // Fetch issues using JQL
            const response = await api
              .asApp()
              .requestJira(route`/rest/api/3/search/jql`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  jql: jql,
                  fields: ["customField10100"],
                  maxResults: 1000, // Adjust as needed
                }),
              });

            const data = await response.json();
            console.log(data);
            if (!response.ok) {
              console.error("Error fetching issues:", data);
            }

            const issues = data.issues;
            console.log(issues);
            // Extract the "WO-FTR (Without Rejection)[Number]" values
            const values = issues
              .map((issue) => {
                const value = issue.fields[customField10100];
                return typeof value === "number" ? value : null;
              })
              .filter((value) => value !== null);

            // Calculate the average
            const total = values.reduce((sum, value) => sum + value, 0);
            const average =
              workOrders.length > 0 ? total / workOrders.length : 0;
            console.log(
              "test avg ",
              Number((average * 100)?.toFixed(1)) || null,
            );
            console.log(average);
            const updateResponse = await api
              .asApp()
              .requestJira(route`/rest/api/3/issue/${updateKey}`, {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  fields: {
                    [customField10100]: Number(average?.toFixed(1)) || null,
                    [customField10101]:
                      Number((average * 100)?.toFixed(1)) || null,
                  },
                }),
              });
          } catch (error) {
            console.error("Error:", error);
          }
        }

        if (type == "Task") {
          console.log(
            "test ",
            Number(fieldValue10056?.toFixed(1)) || null,
            typeof Number(fieldValue10056?.toFixed(1)) || null,
          );
          const updateResponse = await api
            .asApp()
            .requestJira(route`/rest/api/3/issue/${issueId}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                fields: {
                  [customField10092]:
                    issueData.fields.status.name === "Closed"
                      ? Number(fieldValue10056.toFixed(1))
                      : null,
                  [customField10972]:
                    issueData.fields.status.name === "Closed"
                      ? Number(fieldValue10081.toFixed(1))
                      : null,
                },
              }),
            });

          const parentIssueId = await fetchParentIssueId(issueId);
          if (parentIssueId) {
            await propagateActivityHours(parentIssueId, customField10092);
            await propagateActivityHours(parentIssueId, customField10972);
          }
        }

        if (type == "Activity") {
          console.log(fieldValue10061);
          // if (fieldValue10061 > 0) {
          const updateResponse = await api
            .asApp()
            .requestJira(route`/rest/api/3/issue/${issueId}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                fields: {
                  [customField10093]:
                    issueData.fields.status.name === "Closed"
                      ? fieldValue10065 != null
                        ? Number(fieldValue10065.toFixed(1))
                        : null
                      : null,
                  [customField10971]:
                    issueData.fields.status.name === "Closed"
                      ? fieldValue10061 != null
                        ? Number(fieldValue10061.toFixed(1))
                        : null
                      : null,
                },
              }),
            });

          const parentIssueId = await fetchParentIssueId(issueId);
          if (parentIssueId) {
            await propagateActivityHoursBulk(parentIssueId, [
              customField10971,
              customField10093,
              customField10094,
              customField10095,
            ]);
            // await propagateActivityHours(parentIssueId, customField10971);
            // await delay(10000)
            // await propagateActivityHours(parentIssueId, customField10093);
            // await delay(10000)
            // await propagateActivityHours(parentIssueId, customField10094);
            // await delay(10000)
            // await propagateActivityHours(parentIssueId, customField10095);
            // await delay(10000)
          }
          // }
        }

        ////DED
        if (!["Project", "Phase", "Activity Group"].includes(type)) {
          const updateResponse1 = await api
            .asApp()
            .requestJira(route`/rest/api/3/issue/${issueId}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                fields: {
                  [customField10094]: dateDifference(
                    fieldValue10015,
                    fieldValue10053,
                    fieldValue10009,
                    "end",
                  ),
                  [customField10095]: dateDifference(
                    fieldValue10015,
                    fieldValue10053,
                    fieldValue10009,
                    "start",
                  ),
                  [customField10096]: Number(
                    (
                      ((dateDifference(
                        fieldValue10015,
                        fieldValue10053,
                        fieldValue10009,
                        "end",
                      ) -
                        dateDifference(
                          fieldValue10015,
                          fieldValue10053,
                          fieldValue10009,
                          "start",
                        )) /
                        dateDifference(
                          fieldValue10015,
                          fieldValue10053,
                          fieldValue10009,
                          "start",
                        )) *
                      100
                    )?.toFixed(1),
                  ),
                },
              }),
            });
          const d = {
            [customField10094]: dateDifference(
              fieldValue10015,
              fieldValue10053,
              fieldValue10009,
              "end",
            ),
            [customField10095]: dateDifference(
              fieldValue10015,
              fieldValue10053,
              fieldValue10009,
              "start",
            ),
            [customField10096]: Number(
              (
                ((dateDifference(
                  fieldValue10015,
                  fieldValue10053,
                  fieldValue10009,
                  "end",
                ) -
                  dateDifference(
                    fieldValue10015,
                    fieldValue10053,
                    fieldValue10009,
                    "start",
                  )) /
                  dateDifference(
                    fieldValue10015,
                    fieldValue10053,
                    fieldValue10009,
                    "start",
                  )) *
                100
              )?.toFixed(1),
            ),
          };

          console.log(
            issueData.key,
            fieldValue10009,
            fieldValue10015,
            fieldValue10053,
            "testDate",
            JSON.stringify(d),
          );
          if (updateResponse1.ok) {
            console.log(`Successfully updated ${JSON.stringify(d)}`);
          } else {
            console.error(`Failed to update: ${await updateResponse1.text()}`);
          }
        } else {
          const totalUpdatedCAEIteration =
            (fieldValue11003 / (fieldValue11003 + fieldValue11036)) * 100;

          const updateResponse1 = await api
            .asApp()
            .requestJira(route`/rest/api/3/issue/${issueId}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                fields: {
                  [customField10096]: Number(
                    (
                      ((fieldValue10094 - fieldValue10095) / fieldValue10095) *
                      100
                    )?.toFixed(1),
                  ),
                  customfield_10608: Number(
                    totalUpdatedCAEIteration?.toFixed(1),
                  ),
                },
              }),
            });

          if (updateResponse1.ok) {
            console.log(`Successfully updated `);
          } else {
            console.error(`Failed to update: ${await updateResponse1.text()}`);
          }
        }

        //CAE
        if (type == "Activity") {
          console.log("entered");
          // console.log(kd)
          if (
            !(
              issueData.fields.summary.includes("Extra Work") ||
              issueData.fields.summary.includes("Re-Work")
            )
          ) {
            async function getFilteredIterationIssues(
              activityIssueKey,
              summaryMatch,
            ) {
              try {
                // Step 1: Get the Activity Issue details
                const activityIssue = await api
                  .asApp()
                  .requestJira(route`/rest/api/3/issue/${activityIssueKey}`);
                const activityData = await activityIssue.json();

                if (!activityData.fields.issuelinks) {
                  throw new Error("No issue links found for the activity.");
                }

                let activityGroupKey = null;

                // Step 2: Find the linked Activity Group (Hierarchy link)
                for (const link of activityData.fields.issuelinks) {
                  if (
                    link.type.name === "Hierarchy link (WBSGantt)" &&
                    link.inwardIssue
                  ) {
                    activityGroupKey = link.inwardIssue.key;
                    break;
                  }
                }

                if (!activityGroupKey) {
                  throw new Error("Activity Group not found.");
                }

                // Step 3: Fetch the Activity Group issue to get Phase
                const activityGroupIssue = await api
                  .asApp()
                  .requestJira(route`/rest/api/3/issue/${activityGroupKey}`);
                const activityGroupData = await activityGroupIssue.json();

                let phaseKey = null;

                for (const link of activityGroupData.fields.issuelinks) {
                  if (
                    link.type.name === "Hierarchy link (WBSGantt)" &&
                    link.inwardIssue
                  ) {
                    phaseKey = link.inwardIssue.key;
                    break;
                  }
                }

                if (!phaseKey) {
                  throw new Error("Phase not found.");
                }

                // Step 4: Fetch all Activity Groups under this Phase

                const activityGroupsData = await fetchLinkedIssues(phaseKey);

                if (!activityGroupsData.length) {
                  throw new Error("No Activity Groups found under this Phase.");
                }

                const iterationGroupKey = activityGroupsData.find((issue) =>
                  issue.summary.includes("| ITERATIONS | ITERATIONS"),
                );
                const iterationStdActivityGroup = activityGroupsData.find(
                  (issue) =>
                    issue.summary.includes(summaryMatch.replace(" | Iter", "")),
                );

                const iterationActivities = await fetchLinkedIssues(
                  iterationGroupKey.key,
                );
                const filteredIteration = iterationActivities.filter((issue) =>
                  issue.summary.includes(summaryMatch),
                );
                console.log(filteredIteration);
                console.log(iterationStdActivityGroup);
                // Step 7: Fetch Actual Hours for Standard Iteration Activity Group via REST API
                const stdActivityResponse = await api
                  .asApp()
                  .requestJira(
                    route`/rest/api/3/issue/${iterationStdActivityGroup.key}`,
                  );
                const stdActivityData = await stdActivityResponse.json();
                const stdActualHours =
                  stdActivityData.fields?.customfield_10065 || 0; // Replace XXXXX with 'Actual Hours' field ID (avoid division by zero)

                console.log(
                  "Actual Hours of Standard Iteration Activity:",
                  stdActualHours,
                  iterationStdActivityGroup.key,
                );
                let iterStd = stdActualHours;
                let iterActual = 0;
                // Step 8: Iterate through each filtered iteration activity, fetch actual hours via API & update issue
                for (const issue of filteredIteration) {
                  // Fetch issue details from REST API
                  const issueResponse = await api
                    .asApp()
                    .requestJira(route`/rest/api/3/issue/${issue.key}`);
                  const issueData = await issueResponse.json();

                  const actualHours = issueData.fields?.customfield_10065 || 0; // Replace XXXXX with 'Actual Hours' field ID
                  iterActual += actualHours;
                  const updatedCAEIteration = stdActualHours
                    ? (actualHours / (stdActualHours + actualHours)) * 100
                    : null;
                  console.log(
                    "data",
                    fieldValue10065,
                    actualHours,
                    stdActualHours,
                  );

                  console.log(
                    `Issue ${issue.key} - Actual Hours: ${actualHours}, Updated CAE Iteration: ${updatedCAEIteration}`,
                  );

                  // Update issue with new CAE Iteration value
                  await api
                    .asApp()
                    .requestJira(route`/rest/api/3/issue/${issue.key}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        fields: {
                          customfield_10608:
                            Number(updatedCAEIteration?.toFixed(1)) || null, // Replace YYYYY with CAE Iteration field ID
                        },
                      }),
                    });

                  console.log(`Updated CAE Iteration for issue ${issue.key}`);
                }
                console.log(
                  "Iter Actual",
                  iterActual,
                  iterStd,
                  (iterActual / (iterStd + iterActual)) * 100,
                );
                const totalUpdatedCAEIteration =
                  (iterActual / (iterStd + iterActual)) * 100;
                await api
                  .asApp()
                  .requestJira(
                    route`/rest/api/3/issue/${iterationStdActivityGroup.key}`,
                    {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        fields: {
                          customfield_11003: Number(iterActual?.toFixed(1)), // Replace YYYYY with CAE Iteration field ID
                          customfield_11036: iterStd,
                          customfield_10607: filteredIteration.length,
                          customfield_10608: Number(
                            totalUpdatedCAEIteration?.toFixed(1),
                          ),
                        },
                      }),
                    },
                  );

                // console.log(kh)
              } catch (error) {
                console.error(
                  "Error fetching Iteration Issues:",
                  error.response.status,
                  " --- ",
                  error.message,
                );
                return [];
              }
            }
            function normalizeIteration(summary) {
              return summary.replace(/\s*\|\s*(Loop|Iter)\s*\d+$/, " | Iter");
            }
            let finalFilteredIssues = await getFilteredIterationIssues(
              issueData.key,
              normalizeIteration(issueData.fields.summary),
            );
            console.log("testttttt");
            console.log(finalFilteredIssues);
            // console.log(kd)
          }
        }

        // if(type== "Activity Group"){
        //   await propagateActivityHoursBulk(issueData.key, [customField11003, customField11036,customField10607])

        // }
      } catch (error) {
        console.error(
          "Error in updateKPI Event Listener: ",
          error.response.status,
          " --- ",
          error.message,
        );
      }

      success = true; // Exit loop on success
    } catch (error) {
      if (error) {
        console.warn(
          `⚠️ Rate limit reached. Retrying in ${2 ** retryCount} seconds...`,
        );
        await delay(2 ** retryCount * 1000); // Exponential backoff
        retryCount++;
      } else {
        console.error("❌ Error processing KPI update:", error);
        break; // Break the loop for non-rate-limit errors
      }
    }
  }
  if (!success) {
    console.error("❌ Failed to process KPI update after multiple retries");
  }
}

export const trigger = async ({ context }) => {
  console.log("Scheduled trigger invoked ");
  // console.log(context);
  await updateTodayQueue.push(context);
  return { success: true, message: "Task has been queued for processing." };
  // Add your business logic here
};

function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split("T")[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function updateIssuesDateField(jql, dateFieldId) {
  const jqlEncoded = jql; //encodeURIComponent(jql);
  console.log(`/rest/api/3/search/jql?jql=${jqlEncoded}&maxResults=25`);
  const searchResponse = await retryJiraApiCall(() =>
    api
      .asApp()
      .requestJira(
        route`/rest/api/3/search/jql?jql=${jqlEncoded}&maxResults=25`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      ),
  );

  if (!searchResponse.ok) {
    const errText = await searchResponse.text();
    console.error(`JQL error: ${errText}`);
    throw new Error("Failed to run JQL");
  }

  const data = await searchResponse.json();
  const issues = data.issues || [];
  const todayStr = getTodayDateString();

  for (const issue of issues) {
    const issueKey = issue.key;
    console.log(`Updating ${issueKey}...`);

    const updateRes = await retryJiraApiCall(() =>
      api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            [dateFieldId]: todayStr,
          },
        }),
      }),
    );

    if (!updateRes.ok) {
      const errorText = await updateRes.text();
      console.error(`Failed to update ${issueKey}: ${errorText}`);
    } else {
      console.log(`✅ Updated ${issueKey} to ${todayStr}`);
    }

    await sleep(3000); // wait for 3 seconds
  }
}

export async function updateToday(context) {
  console.log("Scheduled trigger invoked 1");
  console.log(context);
  const rawJql = `project in ( CWO) AND issuetype in (Activity, "Work Order", Task) AND (cf[11168] < now() OR cf[11168] IS EMPTY) ORDER BY cf[11168] ASC`;
  // const rawJql = `project in (CDEMO) AND (cf[11168] < now() OR cf[11168] IS EMPTY) ORDER BY cf[11168] ASC`;

  await updateIssuesDateField(rawJql, "customfield_11168");
}

export async function enqueueQuotationIssue(event, context) {
  let retryCount = 0;
  let success = false;

  while (!success && retryCount < 5) {
    try {
      console.log(
        `🚀 Attempting to enqueue quotation update (Try ${retryCount + 1})`,
        event,
      );
      await updateQuotationQueue.push(event, context);
      console.log("✅ Successfully enqueued Quotation update");
      success = true; // Exit loop on success
    } catch (error) {
      if (error.name === "RateLimitError") {
        console.warn(
          `⚠️ Rate limit reached. Retrying in ${2 ** retryCount} seconds...`,
        );
        await delay(2 ** retryCount * 1000); // Exponential backoff
        retryCount++;
      } else {
        console.error("❌ Error enqueuing Quotation update:", error);
        break; // Break the loop for non-rate-limit errors
      }
    }
  }
  if (!success) {
    console.error(
      "❌ Failed to enqueue Quotation update after multiple retries",
    );
  }
}
export async function updateQuotationIssue(event, context) {
  console.log("Quotation Update Triggered !!!!!!!!!!!!");
  const issueKey = event.call.payload.issue.key;
  console.log("Issue Key", issueKey);

  const issue = await fetchIssue(issueKey);
  const product = issue.fields["customfield_10073"].value; // Product-BU custom field
  const customer = issue.fields["customfield_10838"].value; // Customer custom field

  let base64String = await storage.get(STORAGE_KEY);
  const uint8Arr = base64ToUint8Array(base64String);
  const decompressedString = pako.inflate(uint8Arr, { to: "string" });
  let data = JSON.parse(decompressedString);
  const t_ceco_summary = data["T_CECO_SUMMARY"]["records"][customer];
  console.log(data["T_CECO_SUMMARY"]["records"][customer][product]);
  const fieldsToUpdate = {
    customfield_11283: t_ceco_summary["Common"]["CATIA / NX"],
    customfield_11275: t_ceco_summary[product]?.["3D_TDL"],
  };
  const updateQuotation = await updateIssueWithRetry(issueKey, fieldsToUpdate);
  if (updateQuotation.ok) {
    console.log("T_CECO_SUMMARY details Updated");
  }
}

resolver.define("getQuotationData", async ({ payload }) => {
  let { issue } = payload;
  console.log("fetching...");
  console.log("Key: " + issue.key);
  const issueResponse = await fetchIssue(issue.key);
  const product = issueResponse.fields["customfield_10073"]?.value; // Product-BU custom field
  const customer = issueResponse.fields["customfield_10838"]?.value;
  // First, try to get quotation data from storage
  let quot = await storage.get(`Quot_${product}_${customer}_${issue.key}`);

  // If quotation data exists and has values, return it
  if (quot && Object.keys(quot).length > 0) {
    console.log("Returning cached quotation data");
    return quot;
  }

  // If no quotation data or empty, fetch from compressed storage
  console.log("No cached quotation found, fetching from compressed storage");

  try {
    let base64String = await storage.get(STORAGE_KEY);

    if (!base64String) {
      console.log("No data found in storage");
      return {};
    }

    const uint8Arr = base64ToUint8Array(base64String);
    const decompressedString = pako.inflate(uint8Arr, { to: "string" });
    let data = JSON.parse(decompressedString);

    // Fetch issue to get product information
    const issueResponse = await fetchIssue(issue.key);
    const product = issueResponse.fields["customfield_10073"]?.value; // Product-BU custom field
    const customer = issueResponse.fields["customfield_10838"]?.value; // Customer custom field

    if (!product) {
      console.log("No product found for issue");
      return {};
    }

    const productData = data[product];
    return productData || {};
  } catch (error) {
    console.error("Error fetching quotation data:", error);
    return {};
  }
});
resolver.define("saveQuotationData", async ({ payload }) => {
  let { issue, data } = payload;
  console.log("fetching...");
  console.log("Key" + issue);
  const issueResponse = await fetchIssue(issue);
  const revision = issueResponse.fields["customfield_11663"]; // to be used while craeting revision
  const product = issueResponse.fields["customfield_10073"]?.value; // Product-BU custom field
  const customer = issueResponse.fields["customfield_10838"]?.value;
  if (!data) {
    throw new Error("No data provided for update");
  }

  await storage.set(`Quot_${product}_${customer}_${issue}`, data);
  return { success: true };
});
export const handler = resolver.getDefinitions();
export const handler1 = resolver1.getDefinitions();
