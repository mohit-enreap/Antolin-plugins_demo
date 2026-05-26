import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";

const resolver = new Resolver();

resolver.define("getIssuesByJQL", async ({ payload }) => {
  let { jql } = payload; // Extract JQL from the payload

  if (!jql) {
    return { error: "JQL query is not provided in the payload" };
  }

  if (jql === `"type" = Project ORDER BY key ASC`)
    jql = `"type" = Project AND project NOT IN ("CWO Demo") ORDER BY key ASC`;

  console.log(jql);
  // try {
  //   let allIssues = [];
  //   let startAt = 0;
  //   const maxResults = 100; // Adjust based on API limits

  //   while (true) {
  //     // const response = await api.asApp().requestJira(
  //     //   route`/rest/api/2/search?jql=type=Project&startAt=${startAt}&maxResults=${maxResults}`
  //     // );
  //     const response = await api
  //       .asApp()
  //       .requestJira(route`/rest/api/3/search/jql`, {
  //         method: "POST",
  //         headers: {
  //           "Content-Type": "application/json",
  //           // Optional: 'Accept': 'application/json'
  //         },
  //         body: JSON.stringify({
  //           jql: jql,
  //           fields: ["summary", "customfield_10970"],
  //           maxResults: maxResults,
  //         }),
  //       });
  //     // console.log(`/rest/api/2/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}`)
  //     if (!response.ok) {
  //       return { error: `Failed to fetch issues. Status: ${response.status}` };
  //     }

  //     const data = await response.json();
  //     console.log(data);
  //     allIssues = allIssues.concat(data.issues);
  //     console.log(allIssues);
  //     if (data.issues.length < maxResults) {
  //       break; // No more issues to fetch
  //     }

  //     startAt += maxResults;
  //   }
  //   return { issues: allIssues };
  // } catch (error) {
  //   return { error: `Error fetching issues: ${error.message}` };
  // }

  try {
    let allIssues = [];
    // let startAt = 0;
    const maxResults = 100; // Adjust based on API limits

    const response = await api
      .asApp()
      .requestJira(route`/rest/api/3/search/jql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Optional: 'Accept': 'application/json'
        },
        body: JSON.stringify({
          jql: jql,
          fields: ["summary", "customfield_10970"],
          maxResults: maxResults,
        }),
      });
    // console.log(`/rest/api/2/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}`)
    if (!response.ok) {
      return { error: `Failed to fetch issues. Status: ${response.status}` };
    }

    const data = await response.json();
    console.log(data);
    allIssues = allIssues.concat(data.issues);
    console.log(allIssues);
    // if (data.issues.length < maxResults) {
    //   break; // No more issues to fetch
    // }

    let nextPageToken = data.nextPageToken; // Assuming the API provides a token for the next page
    let lastPage = data.isLast; // Assuming the API provides a flag to indicate if it's the last page
    // startAt += maxResults;

    while (!lastPage) {
      // Loop until the last page is reached
      // const response = await api.asApp().requestJira(
      //   route`/rest/api/2/search?jql=type=Project&startAt=${startAt}&maxResults=${maxResults}`
      // );
      const response = await api
        .asApp()
        .requestJira(route`/rest/api/3/search/jql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Optional: 'Accept': 'application/json'
          },
          body: JSON.stringify({
            jql: jql,
            fields: ["summary", "customfield_10970"],
            maxResults: maxResults,
            nextPageToken: nextPageToken, // Include the token for the next page
          }),
        });
      // console.log(`/rest/api/2/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}`)
      if (!response.ok) {
        return {
          error: `Failed to fetch issues. Status: ${response.status}`,
        };
      }

      const data = await response.json();
      console.log(data);
      allIssues = allIssues.concat(data.issues);
      console.log(allIssues);
      lastPage = data.isLast; // Update the lastPage flag based on the response
      if (lastPage) {
        break; // If it's the last page, exit the loop
      }
      nextPageToken = data.nextPageToken;

      // startAt += maxResults;
    }

    return { issues: allIssues };
  } catch (error) {
    return { error: `Error fetching issues: ${error.message}` };
  }
});

// Fetch all "Project" issue type issues

// Export all resolver definitions
export const handler = resolver.getDefinitions();
