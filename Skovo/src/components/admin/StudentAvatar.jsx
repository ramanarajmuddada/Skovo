import React from 'react';
import AvatarImg from '../ui/AvatarImg';

/** Photo, or the first letter of the name — admin student list and page. */
export default function StudentAvatar({ s, size = 'w-10 h-10 text-sm' }) {
  return s.avatar_url
    ? <AvatarImg src={s.avatar_url} alt="" className={`${size} rounded-xl object-cover shrink-0`} />
    : (
      <div className={`${size} rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0`}>
        {s.full_name?.charAt(0)?.toUpperCase() || 'S'}
      </div>
    );
}
