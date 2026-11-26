import { Gift } from "lucide-react";

export function RecipientWishlist({ wishlist }: { wishlist: string }) {
  const hasWishlist = Boolean(wishlist.trim());
  return <section className="recipient-wishlist" aria-labelledby="recipient-wishlist-title">
    <h4 id="recipient-wishlist-title"><Gift size={17} aria-hidden="true" />Their wishlist</h4>
    {hasWishlist ? <p className="wishlist-text">{wishlist.split(/(https?:\/\/[^\s<>"']+)/gi).map((part, index) => {
      if (!/^https?:\/\//i.test(part)) return part;
      const url = part.replace(/[.,!?;:]+$/, "");
      return <span key={index}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{part.slice(url.length)}</span>;
    })}</p> : <p className="wishlist-empty">They didn’t add a wishlist before the draw started.</p>}
  </section>;
}
