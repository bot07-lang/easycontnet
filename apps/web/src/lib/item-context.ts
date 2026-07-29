import { createContext, useContext } from 'react';

/** The content item currently open in the editor — so field/file/text comment
 *  affordances can post/read comments without prop-drilling the id everywhere. */
export const ItemIdContext = createContext<string | null>(null);
export const useItemId = () => useContext(ItemIdContext);
