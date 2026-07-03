import { useState } from 'react';

export default function NamePrompt({ onSubmit }) {
  const [value, setValue] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const name = value.trim();
    if (name) onSubmit(name);
  };

  return (
    <div className="center-screen">
      <div className="logo-block">
        <div className="logo">🎉 PartyQueue</div>
        <p className="tagline">Vote for the next song</p>
      </div>
      <form className="card name-form" onSubmit={submit}>
        <label htmlFor="name">What should we call you?</label>
        <input
          id="name"
          autoFocus
          maxLength={24}
          placeholder="Your name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
          Join the party
        </button>
      </form>
    </div>
  );
}
