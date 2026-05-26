import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";

const resolver = new Resolver();

resolver.define("getIssuesByJQL", async ({ payload }) => {
  const { jql } = payload; // Extract JQL from the payload

  if (!jql) {
    return { error: "JQL query is not provided in the payload" };
  }
  console.log(jql);
  try {
    console.log("hello");
    let allIssues = [];

    let jsonPayload = {
      jql: jql,
      fields: ["summary"],
      maxResults: 1000,
      nextPageToken: null,
    };
    // const maxResults = 1000; // Adjust based on API limits

    while (true) {
      const response = await api
        .asApp()
        .requestJira(route`/rest/api/3/search/jql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Optional: 'Accept': 'application/json'
          },
          body: JSON.stringify(jsonPayload),
        });

      if (!response.ok) {
        return { error: `Failed to fetch issues. Status: ${response.status}` };
      }

      const data = await response.json();
      console.log(response.status);
      allIssues = allIssues.concat(data.issues);
      // console.log(allIssues);

      if (data.isLast) {
        break;
      }

      jsonPayload.nextPageToken = data.nextPageToken; // No more issues to fetch
    }

    console.log("Issues fetched = ", allIssues.length);
    return { issues: allIssues };
  } catch (error) {
    return { error: `Error fetching issues: ${error.message}` };
  }
});

// Export all resolver definitions
export const handler = resolver.getDefinitions();
