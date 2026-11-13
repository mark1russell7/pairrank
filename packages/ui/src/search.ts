/**
 * The word search of the screens. A text agrees with a search when the text has each word of the search, in any case
 * and in any order. The Sites screen and the tag screen use it.
 */

/**
 * This function gives the test of a search text. The test tells if a text has each word of the search. The case of the
 * letters is not significant. A search with no words agrees with each text.
 */
export function wordSearch(query: string): (text: string) => boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  return (text) => {
    const lower = text.toLowerCase();
    return words.every((word) => lower.includes(word));
  };
}
