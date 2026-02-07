defmodule Guardian.Repo.Chat do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:jid, :string, autogenerate: false}
  schema "chats" do
    field :name, :string
    field :last_message_time, :string
  end

  def changeset(chat, attrs) do
    chat
    |> cast(attrs, [:jid, :name, :last_message_time])
    |> validate_required([:jid])
  end
end
