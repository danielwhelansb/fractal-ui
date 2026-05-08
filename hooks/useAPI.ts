import useSWR from "swr";

export const useAPI = <T>(url: string | null | false | undefined) => {
  const fetcher = async (u: string): Promise<T> => {
    const res = await fetch(u);

    if (!res.ok) {
      const errorRes = await res.json();
      throw new Error(errorRes.error);
    }

    return res.json();
  };

  const { data, mutate, isLoading, error } = useSWR<T>(url || null, fetcher);

  return { data, mutate, isLoading, error };
};
