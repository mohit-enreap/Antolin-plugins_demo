// WO
const coo2D =
  additionalProps.parentIssue.fields["customfield_10079"][0]["accountId"] ||
  null;

const coo3D =
  additionalProps.parentIssue.fields["customfield_10046"][0]["accountId"] ||
  null;

const createdWO = await createIssue({
  projectId: additionalProps.projectId,
  issueTypeId: "10009", // Replace with your Work Order issue type ID
  summary: woSummary,
  customfield_10078: additionalProps.issueKey,
  customfield_10970: additionalProps.phase,
  assignee: {
    id:
      woSummary.includes("2D Drawing") || woSummary.includes("2D DELIVERABLES")
        ? coo2D
        : coo3D,
  },
});

// TASK

const designer2D =
  additionalProps.parentIssue.fields["customfield_10080"][0]["accountId"] ||
  null;
const designer3D =
  additionalProps.parentIssue.fields["customfield_10047"][0]["accountId"] ||
  null;

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
        ? designer2D
        : designer3D,
  },
});
