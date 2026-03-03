import fetch from "cross-fetch";

export interface RawPost {
    source: string;
    title: string;
    url: string;
    content_snippet: string;
}

/**
 * Fetch top and new posts from a specific subreddit
 */
export async function fetchReddit(subreddit: string): Promise<RawPost[]> {
    const posts: RawPost[] = [];
    try {
        console.log(`📡 Fetching Reddit: r/${subreddit}`);
        // Fetch both 'hot' and 'new' to not miss anything
        for (const sort of ["hot", "new"]) {
            const response = await fetch(`https://www.reddit.com/r/${subreddit}/${sort}.json?limit=25`, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
            });
            if (!response.ok) continue;

            const data = await response.json();
            const children = data?.data?.children || [];

            for (const child of children) {
                const post = child.data;
                if (!post || post.stickied) continue; // Skip pinned posts

                // Skip if not enough text or just an image, unless the title is very descriptive
                const selftext = post.selftext || "";

                posts.push({
                    source: `Reddit (r/${subreddit})`,
                    title: post.title,
                    url: `https://reddit.com${post.permalink}`,
                    content_snippet: selftext.substring(0, 1000) // Keep reasonable size for LLM
                });
            }
        }
    } catch (err) {
        console.error(`❌ Error fetching Reddit r/${subreddit}:`, err);
    }

    // Deduplicate by URL
    const uniquePosts = Array.from(new Map(posts.map(p => [p.url, p])).values());
    return uniquePosts;
}

/**
 * Fetch top stories from Hacker News
 */
export async function fetchHackerNews(): Promise<RawPost[]> {
    const posts: RawPost[] = [];
    try {
        console.log(`📡 Fetching Hacker News`);
        // Get top 50 story IDs
        const topResponse = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
        const newResponse = await fetch("https://hacker-news.firebaseio.com/v0/newstories.json");

        const topIds: number[] = topResponse.ok ? await topResponse.json() : [];
        const newIds: number[] = newResponse.ok ? await newResponse.json() : [];

        // Combine and take top 60 to avoid rate limiting ourselves
        const storyIds = Array.from(new Set([...topIds.slice(0, 30), ...newIds.slice(0, 30)]));

        // Fetch details concurrently in batches
        const BATCH_SIZE = 10;
        for (let i = 0; i < storyIds.length; i += BATCH_SIZE) {
            const batch = storyIds.slice(i, i + BATCH_SIZE);
            const promises = batch.map(id =>
                fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(res => res.json())
            );

            const results = await Promise.all(promises);
            for (const item of results) {
                if (!item || item.type !== "story" || item.dead || item.deleted) continue;

                posts.push({
                    source: "Hacker News",
                    title: item.title,
                    url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
                    content_snippet: item.text ? item.text.substring(0, 1000) : "No text content (Link post)"
                });
            }
        }
    } catch (err) {
        console.error("❌ Error fetching Hacker News:", err);
    }

    return posts;
}

export async function fetchAllSources(): Promise<RawPost[]> {
    const redditSources = ["LocalLLaMA", "MachineLearning", "OpenAI", "singularity", "artificial"];

    let allPosts: RawPost[] = [];

    const hnPosts = await fetchHackerNews();
    allPosts = allPosts.concat(hnPosts);

    for (const sub of redditSources) {
        const redditPosts = await fetchReddit(sub);
        allPosts = allPosts.concat(redditPosts);
    }

    return allPosts;
}
