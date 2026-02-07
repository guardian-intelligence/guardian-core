defmodule Guardian.Repo.Message do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  schema "messages" do
    field :id, :string, primary_key: true
    field :chat_jid, :string, primary_key: true
    field :sender, :string
    field :sender_name, :string
    field :content, :string
    field :timestamp, :string
    field :is_from_me, :integer
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:id, :chat_jid, :sender, :sender_name, :content, :timestamp, :is_from_me])
    |> validate_required([:id, :chat_jid])
    |> validate_inclusion(:is_from_me, [0, 1])
  end
end
