import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";

const resolver = new Resolver();

resolver.define("getIssuesByJQL", async ({ payload }) => {
  const { jql } = payload;

  if (!jql) {
    return { error: "JQL query is not provided in the payload" };
  }

  try {
    let allIssues = [];
    let jsonPayload = {
      jql: jql,
      // ADD your version manifest field (customfield_12257) to the fields array
      fields: ["summary", "customfield_12257"],
      maxResults: 1000,
      nextPageToken: null,
    };

    while (true) {
      const response = await api
        .asApp()
        .requestJira(route`/rest/api/3/search/jql`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jsonPayload),
        });

      if (!response.ok) {
        return { error: `Failed to fetch issues. Status: ${response.status}` };
      }

      const data = await response.json();
      allIssues = allIssues.concat(data.issues);

      if (data.isLast || !data.nextPageToken) {
        break;
      }

      jsonPayload.nextPageToken = data.nextPageToken;
    }

    return { issues: allIssues };
  } catch (error) {
    return { error: `Error fetching issues: ${error.message}` };
  }
});

export const handler = resolver.getDefinitions();
