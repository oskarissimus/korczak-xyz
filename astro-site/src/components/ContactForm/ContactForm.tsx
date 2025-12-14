import { useCallback } from 'react';

const sendForm = async (data: FormData): Promise<void> => {
  const url = 'https://getform.io/f/da77d728-d0c5-4090-9a77-799464d888ff';
  try {
    await fetch(url, {
      method: 'POST',
      body: data,
      headers: {
        Accept: 'application/json',
      },
    });
    alert('Thank you for your message!');
  } catch (error) {
    console.log(error);
  }
};

const getDataFromForm = (form: HTMLFormElement): FormData => {
  const data = new FormData(form);
  return data;
};

const clearForm = (form: HTMLFormElement): void => {
  form.reset();
};

export default function ContactForm() {
  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form) return;
      const data = getDataFromForm(form);
      await sendForm(data);
      clearForm(form);
    },
    []
  );

  return (
    <form
      acceptCharset="UTF-8"
      className="flex flex-col gap-4"
      data-testid="contact-form"
      onSubmit={handleSubmit}
    >
      <label className="block">
        <span className="font-bold">Name</span>
        <input
          type="text"
          name="name"
          className="block w-1/2 mt-1 dark:bg-[#1c1c1c] dark:border-[#444444]"
          placeholder="Enter name"
          required
        />
      </label>
      <label className="block">
        <span className="font-bold">Email</span>
        <input
          type="email"
          name="email"
          className="block w-1/2 mt-1 dark:bg-[#1c1c1c] dark:border-[#444444]"
          placeholder="Enter email"
          required
        />
      </label>
      <label className="block">
        <span className="font-bold">Message</span>
        <textarea
          name="message"
          className="block w-full mt-1 dark:bg-[#1c1c1c] dark:border-[#444444]"
          required
          placeholder="Enter message"
        />
      </label>
      <input type="hidden" name="_gotcha" style={{ display: 'none' }} />
      <button
        type="submit"
        className="px-6 py-4 text-xl dark:bg-[#1c1c1c] hover:opacity-80 bg-[#eee]"
      >
        Submit
      </button>
    </form>
  );
}
